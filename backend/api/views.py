import os
import logging
from django.http import JsonResponse, FileResponse, HttpResponse
from django.conf import settings
from api.services import StockService, is_market_open

logger = logging.getLogger('api')


def get_stock(request):
    try:
        symbols = request.GET.get('symbols', '').split(',')
        if not symbols or symbols == ['']:
            symbols = getattr(settings, 'DEFAULT_SYMBOLS', ['sz000423', 'sz002304'])
            
        data = StockService.fetch_stock_data(symbols)
        result = {
            'stocks': {symbol: {'name': s.name, 'price': s.price, 'time': s.time}
                      for symbol, s in data.items()},
            'is_market_open': is_market_open()
        }
        logger.info(f"Successfully fetched {len(result['stocks'])} stocks")
        return JsonResponse(result)
    except Exception as e:
        logger.error(f"Error fetching stock data: {e}")
        return JsonResponse({'error': str(e)}, status=500)


def get_stock_by_symbols(request, symbols):
    try:
        symbol_list = symbols.split(',')
        data = StockService.fetch_stock_data(symbol_list)
        result = {symbol: {'name': s.name, 'price': s.price, 'time': s.time}
                  for symbol, s in data.items()}
        return JsonResponse(result)
    except Exception as e:
        logger.error(f"Error fetching stock data: {e}")
        return JsonResponse({'error': str(e)}, status=500)


def get_history(request):
    try:
        symbols = request.GET.get('symbols', 'sz000423,sz002304').split(',')
        limit = int(request.GET.get('limit', 240))
        data = StockService.get_history_multi(symbols, limit)
        return JsonResponse(data)
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        return JsonResponse({'error': str(e)}, status=500)


def get_daily_history(request):
    try:
        symbols = request.GET.get('symbols', 'sz000423,sz002304').split(',')
        limit = int(request.GET.get('limit', 30))
        data = StockService.get_daily_history_multi(symbols, limit)
        return JsonResponse(data)
    except Exception as e:
        logger.error(f"Error fetching daily history: {e}")
        return JsonResponse({'error': str(e)}, status=500)


def index(request):
    index_path = os.path.join(settings.DIST_DIR, 'index.html')
    if os.path.exists(index_path):
        return FileResponse(open(index_path, 'rb'), content_type='text/html')
    return HttpResponse(b"Frontend not built. Run 'npm run build' first.", status=500)


def serve_assets(request, path):
    file_path = os.path.join(settings.DIST_DIR, 'assets', path)
    if os.path.exists(file_path):
        return FileResponse(open(file_path, 'rb'))
    return HttpResponse(status=404)
