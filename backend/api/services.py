import re
import time
import logging
from datetime import datetime
from typing import Dict, List
from dataclasses import dataclass
import requests
from django.conf import settings
from django.utils import timezone
from api.models import StockRecord

logger = logging.getLogger('api')

_cache = {}
CACHE_TTL = 10


def is_market_open():
    """判断当前是否为 A 股交易时间（不含节假日校验，后续可扩展）"""
    now = datetime.now()
    # 周六日不交易
    if now.weekday() >= 5:
        return False
    
    h = now.hour
    m = now.minute
    t = h * 60 + m
    
    # 9:30 - 11:30, 13:00 - 15:00
    morning = (9 * 60 + 30 <= t < 11 * 60 + 30)
    afternoon = (13 * 60 <= t < 15 * 60)
    
    return morning or afternoon


@dataclass
class StockData:
    name: str
    price: float
    time: str
    symbol: str = None


class StockService:

    # 增强反爬虫：全仿真浏览器 Headers
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://gu.qq.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }

    # 创建独立 Session，彻底屏蔽 Windows 注册表/环境变量中的代理配置
    _session = requests.Session()
    _session.trust_env = False
    _session.headers.update(HEADERS)

    @classmethod
    def fetch_stock_data(cls, symbols: List[str]) -> Dict[str, StockData]:
        """
        核心数据抓取方法：支持批量拉取，内置缓存与反爬仿真。
        """
        if not symbols:
            return {}
            
        cache_key = ','.join(sorted(symbols))
        now = time.time()
        if cache_key in _cache:
            cached_data, cached_time = _cache[cache_key]
            if now - cached_time < CACHE_TTL:
                return cached_data

        base_url = getattr(settings, 'STOCK_API_URL', 'http://qt.gtimg.cn/q=')
        symbols_str = ','.join(symbols)
        url = f"{base_url}{symbols_str}"

        try:
            # 使用独立 Session 发起请求（已屏蔽系统代理）
            response = cls._session.get(url, timeout=8)
            response.encoding = 'gbk'
            result = cls._parse_response(response.text)
            
            _cache[cache_key] = (result, now)
            # 仅在分时监控模式下入库
            cls._save_to_db(result)
            return result
        except Exception as e:
            logger.error(f"Fetch error for {symbols_str}: {e}")
            # 返回空结果或上一次缓存（可选降级策略）
            return {}

    @classmethod
    def _parse_response(cls, text: str) -> Dict[str, StockData]:
        result = {}
        lines = text.split(';')

        for line in lines:
            line = line.strip()
            if not line:
                continue

            match = re.match(r'v_(sz\d+)="(.*)"', line)
            if not match:
                continue

            symbol = match.group(1)
            fields = match.group(2).split('~')

            try:
                name = fields[1]
                price = float(fields[3])
                time_str = fields[30] if len(fields) > 30 else ''

                if price <= 0:
                    logger.warning(f"Invalid price {price} for {symbol}, skipping")
                    continue

                if not time_str or len(time_str) < 14:
                    time_str = datetime.now().strftime('%Y%m%d%H%M%S')
                    logger.debug(f"Missing time for {symbol}, using current time")

                result[symbol] = StockData(
                    symbol=symbol,
                    name=name,
                    price=price,
                    time=time_str,
                )
                logger.debug(f"Parsed {symbol}: {name} @ {price}")
            except (IndexError, ValueError) as e:
                logger.warning(f"Failed to parse line: {line[:50]}... Error: {e}")
                continue

        if not result:
            raise Exception("No valid stock data found in response")

        return result

    @classmethod
    def fetch_all_stocks(cls):
        """
        定时任务：批量拉取所有监控中的股票并入库，降低请求频率。
        """
        try:
            symbols = settings.DEFAULT_SYMBOLS.split(',')
            cls.fetch_stock_data(symbols)
            logger.info(f"Successfully processed {len(symbols)} stocks in batch task.")
        except Exception as e:
            logger.error(f"Failed in fetch_all_stocks task: {e}")

    @classmethod
    def _save_to_db(cls, data: Dict[str, StockData]):
        try:
            records = []
            for symbol, stock in data.items():
                dt = datetime.strptime(stock.time, '%Y%m%d%H%M%S')
                dt = timezone.make_aware(dt)
                records.append(StockRecord(
                    symbol=symbol,
                    name=stock.name,
                    price=stock.price,
                    time=dt,
                ))
            StockRecord.objects.bulk_create(records)
            logger.debug(f"Saved {len(records)} records to database")
        except Exception as e:
            logger.error(f"Failed to save to database: {e}")

    @classmethod
    def get_history_multi(cls, symbols: List[str], limit: int = 240) -> Dict[str, List[dict]]:
        result = {}
        for symbol in symbols:
            records = StockRecord.objects.filter(symbol=symbol).order_by('-time')[:limit]
            result[symbol] = [
                {
                    'price': r.price,
                    'time': r.time.strftime('%Y%m%d%H%M%S'),
                }
                for r in reversed(list(records))
            ]
        return result

    @classmethod
    def get_daily_history_multi(cls, symbols: List[str], limit: int = 30) -> Dict[str, List[dict]]:
        """
        直连腾讯官方前复权历史 K线 API。
        注意：fqkline API 不支持多股批量，必须逐只查询后合并。
        返回真实近30个交易日的每日收盘价。
        """
        result = {}
        if not symbols:
            return result

        for idx, symbol in enumerate(symbols):
            # 防限流：非首次请求前加入短暂延迟
            if idx > 0:
                time.sleep(0.3)
            url = f"http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{limit},qfq"
            try:
                response = cls._session.get(url, timeout=10)
                if response.status_code != 200:
                    logger.warning(f"K-line API Error for {symbol}: Status {response.status_code}")
                    continue

                data = response.json()
                if data.get('code') != 0 or 'data' not in data:
                    continue

                stock_data = data['data'].get(symbol, {})
                days = stock_data.get('qfqday') or stock_data.get('day') or []

                history_list = []
                for day_item in days:
                    if len(day_item) >= 3:
                        # day_item: ["YYYY-MM-DD", "Open", "Close", "High", "Low", "Volume"]
                        try:
                            history_list.append({
                                'price': float(day_item[2]),  # 收盘价
                                'time': day_item[0],
                            })
                        except ValueError:
                            continue
                result[symbol] = history_list
                logger.info(f"Fetched {len(history_list)} daily records for {symbol}")
            except Exception as e:
                logger.error(f"Failed to fetch daily history for {symbol}: {e}")

        return result
