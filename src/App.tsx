import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Clock, RefreshCcw, AlertCircle, Settings, X, Plus, Trash2, Calendar, LayoutGrid } from 'lucide-react';

// 自定义 Tooltip：显示双股收盘价（名称）与价差
const CustomTooltip = ({ active, payload, label, symbols, stocks }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;
  
  const sym0 = symbols?.[0];
  const sym1 = symbols?.[1];
  const name0 = stocks?.[sym0]?.name || sym0;
  const name1 = stocks?.[sym1]?.name || sym1;
  const price0 = sym0 ? dataPoint[sym0] : undefined;
  const price1 = sym1 ? dataPoint[sym1] : undefined;
  const diff = dataPoint.diff;

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', padding: '12px 16px', minWidth: '180px' }}>
      <div style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase' }}>{label}</div>
      {price0 !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '16px' }}>
          <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: 700 }}>{name0}</span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#334155' }}>{price0.toFixed(2)}</span>
        </div>
      )}
      {price1 !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '16px' }}>
          <span style={{ fontSize: '11px', color: '#14b8a6', fontWeight: 700 }}>{name1}</span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#334155' }}>{name1.length > 0 ? price1.toFixed(2) : ''}</span>
        </div>
      )}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700 }}>当日价差</span>
        <span style={{ fontSize: '13px', fontWeight: 900, color: diff > 0 ? '#059669' : diff < 0 ? '#e11d48' : '#334155' }}>
          {diff > 0 ? '+' : ''}{diff?.toFixed(2)}
        </span>
      </div>
    </div>
  );
};

interface StockData {
  name: string;
  price: number;
  time: string;
}

interface ApiResponse {
  stocks: { [symbol: string]: StockData };
  is_market_open: boolean;
}

interface HistoricalData {
  [symbol: string]: { price: number; time: string }[];
}

interface ChartDataPoint {
  time: string;
  diff: number;
  [key: string]: string | number;
}

type ViewType = 'minute' | 'daily';

const DEFAULT_SYMBOLS = ['sz000423', 'sz002304'];

const formatTimeLabel = (timeStr: string, viewType: ViewType) => {
  if (viewType === 'daily') {
    // Already formatted as YYYY-MM-DD from backend
    return timeStr.slice(5, 10); // MM-DD
  }
  if (timeStr.length === 6) return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
  if (timeStr.length === 14) return `${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}`;
  return timeStr;
};

export default function App() {
  const [symbols, setSymbols] = useState<string[]>(() => {
    const saved = localStorage.getItem('stock_symbols');
    return saved ? JSON.parse(saved) : DEFAULT_SYMBOLS;
  });
  const [viewType, setViewType] = useState<ViewType>('minute');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [stocks, setStocks] = useState<{ [key: string]: StockData | null }>({});
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const retryCount = useRef(0);

  useEffect(() => {
    localStorage.setItem('stock_symbols', JSON.stringify(symbols));
  }, [symbols]);

  const fetchHistory = async () => {
    if (symbols.length < 2) {
        setData([]);
        return;
    }
    try {
      const endpoint = viewType === 'minute' ? '/api/history' : '/api/history/daily';
      const limit = viewType === 'minute' ? 240 : 30;
      const response = await fetch(`${endpoint}?symbols=${symbols.join(',')}&limit=${limit}`);
      if (!response.ok) return;
      const result: HistoricalData = await response.json();
      
      const merged: ChartDataPoint[] = [];

      if (viewType === 'daily') {
        // --- High-Precision Date-Key Join Algorithm ---
        const dateMap: { [date: string]: { [sym: string]: number } } = {};
        const allDatesSet = new Set<string>();

        symbols.forEach(sym => {
          (result[sym] || []).forEach(item => {
            if (!dateMap[item.time]) dateMap[item.time] = {};
            dateMap[item.time][sym] = item.price;
            allDatesSet.add(item.time);
          });
        });

        // Filter for dates that have ALL symbols available (Intersection)
        const commonDates = Array.from(allDatesSet).filter(date => 
          symbols.every(sym => dateMap[date][sym] !== undefined)
        ).sort();

        commonDates.forEach(date => {
          const point: ChartDataPoint = { 
            time: formatTimeLabel(date, 'daily'), 
            diff: Number((dateMap[date][symbols[0]] - dateMap[date][symbols[1]]).toFixed(2)) 
          };
          symbols.forEach(sym => { point[sym] = dateMap[date][sym]; });
          merged.push(point);
        });
      } else {
        // Minute View: Standard sequence merge (usually synced in real-time)
        const stockHists = symbols.map(s => result[s] || []);
        const baseHist = stockHists[0] || [];
        for (let i = 0; i < baseHist.length; i++) {
          const timeStr = baseHist[i].time;
          const point: ChartDataPoint = { time: formatTimeLabel(timeStr, 'minute'), diff: 0 };
          let allAvailable = true;
          symbols.forEach((s, idx) => {
            const h = stockHists[idx][i];
            if (h) point[s] = h.price; else allAvailable = false;
          });
          if (allAvailable && symbols.length >= 2) {
            point.diff = Number(((point[symbols[0]] as number) - (point[symbols[1]] as number)).toFixed(2));
            merged.push(point);
          }
        }
      }
      setData(merged);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const fetchData = async () => {
    if (symbols.length === 0) return;
    try {
      const response = await fetch(`/api/stock?symbols=${symbols.join(',')}`);
      if (!response.ok) throw new Error(`请求失败: ${response.status}`);
      const result: ApiResponse = await response.json();

      setIsMarketOpen(result.is_market_open);
      const newStocks: { [key: string]: StockData } = {};
      symbols.forEach(s => { if (result.stocks[s]) newStocks[s] = result.stocks[s]; });

      setStocks(newStocks);
      setLastUpdated(new Date().toLocaleTimeString());

      if (viewType === 'minute' && symbols.length >= 2 && newStocks[symbols[0]] && newStocks[symbols[1]]) {
        const s1 = newStocks[symbols[0]];
        const s2 = newStocks[symbols[1]];
        const diff = Number((s1.price - s2.price).toFixed(2));
        const formattedTime = formatTimeLabel(s1.time, 'minute');

        setData(prev => {
          const point: ChartDataPoint = { time: formattedTime, diff };
          symbols.forEach(s => { point[s] = newStocks[s]?.price || 0; });
          if (prev.length > 0 && prev[prev.length - 1].time === formattedTime) {
            const updated = [...prev];
            updated[updated.length - 1] = point;
            return updated;
          }
          return [...prev, point].slice(-240);
        });
      }
      setError(null);
      setLoading(false);
      retryCount.current = 0;
    } catch (err) {
      console.error(err);
      retryCount.current++;
      if (retryCount.current >= 3) {
        setError('数据流连接异常，请重试');
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchHistory().then(() => fetchData());
  }, [symbols, viewType]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isMarketOpen && viewType === 'minute') fetchData();
    }, 60000);
    return () => clearInterval(interval);
  }, [isMarketOpen, symbols, viewType]);

  const currentDiff = symbols.length >= 2 && stocks[symbols[0]] && stocks[symbols[1]] 
    ? Number((stocks[symbols[0]]!.price - stocks[symbols[1]]!.price).toFixed(2)) 
    : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans selection:bg-indigo-100 selection:text-indigo-700">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header - Modern White Style */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
              <Activity className="w-7 h-7 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                双维度对冲监控
                {!isMarketOpen && <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md font-bold uppercase tracking-widest border border-slate-200">收盘休市</span>}
              </h1>
              <p className="text-slate-500 mt-1 text-sm font-medium">
                {symbols.length >= 2 ? `${stocks[symbols[0]]?.name || '--'}/ ${stocks[symbols[1]]?.name || '--'}` : '请添加至少两只股票进行比价'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
               <button onClick={() => setViewType('minute')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewType === 'minute' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>分时价差</button>
               <button onClick={() => setViewType('daily')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewType === 'daily' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>历史价差</button>
            </div>
            <div className="h-6 w-px bg-slate-200 mx-1" />
            <button onClick={() => setShowSettings(true)} className="p-2.5 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 transition-all active:scale-95 shadow-sm text-slate-600"><Settings className="w-5 h-5" /></button>
            <div className="hidden lg:flex flex-col items-end">
              <span className="text-[10px] uppercase font-bold text-slate-400">行情同步</span>
              <div className="text-sm font-mono font-bold text-slate-600">{lastUpdated || '--:--:--'}</div>
            </div>
          </div>
        </header>

        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] animate-in fade-in" onClick={() => setShowSettings(false)} />
            <div className="relative w-full max-w-sm h-full bg-white border-l border-slate-200 shadow-2xl p-8 animate-in slide-in-from-right duration-300">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-900"><Settings className="w-5 h-5 text-indigo-600" /> 证券配置</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="space-y-6">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">代码录入</label><div className="flex gap-2"><input type="text" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toLowerCase())} placeholder="sz000423" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" onKeyDown={(e) => { if (e.key === 'Enter' && newSymbol) { setSymbols([...symbols, newSymbol]); setNewSymbol(''); } }} /><button onClick={() => { if(newSymbol) { setSymbols([...symbols, newSymbol]); setNewSymbol(''); } }} className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white shadow-md transition-all"><Plus className="w-5 h-5" /></button></div></div>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">监控队列</label>{symbols.map((s, idx) => (<div key={s} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl transition-all hover:bg-slate-100/50"><div className="flex items-center gap-3"><span className="text-[10px] font-bold text-slate-400 ring-1 ring-slate-200 px-1.5 py-0.5 rounded">{idx + 1}</span><span className="font-mono text-sm font-bold text-slate-700 uppercase">{s}</span></div><button onClick={() => setSymbols(symbols.filter(sym => sym !== s))} className="p-1.5 text-slate-300 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button></div>))}</div>
              </div>
            </div>
          </div>
        )}

        {error && (<div className="bg-rose-50 text-rose-600 p-4 rounded-xl border border-rose-100 text-xs font-semibold flex items-center gap-3 shadow-sm"><AlertCircle className="w-4 h-4" /> {error}</div>)}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm relative group overflow-hidden">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">实时当前价差</h2>
            <div className="flex items-baseline gap-2 relative z-10"><span className={`text-4xl font-black tracking-tighter ${currentDiff !== null ? (currentDiff > 0 ? 'text-emerald-600' : currentDiff < 0 ? 'text-rose-600' : 'text-slate-900') : 'text-slate-200'}`}>{currentDiff !== null ? (currentDiff > 0 ? `+${currentDiff.toFixed(2)}` : currentDiff.toFixed(2)) : '0.00'}</span><span className="text-slate-400 text-xs font-bold font-mono">CNY</span></div>
            {currentDiff !== null && (<div className={`flex items-center gap-1.5 mt-4 px-2.5 py-1 rounded-lg w-fit text-[10px] font-bold uppercase tracking-tight ${currentDiff > 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : currentDiff < 0 ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>{currentDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{currentDiff > 0 ? '基准溢价' : '对比溢价'}</div>)}
          </div>
          {symbols.slice(0, 2).map((s) => (<div key={s} className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-100 transition-all hover:shadow-md"><div className="flex justify-between items-center mb-4"><h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stocks[s]?.name || '--'}</h2><span className="text-[10px] font-mono text-slate-300 font-bold uppercase">{s}</span></div><div className="flex items-baseline gap-2"><span className="text-3xl font-bold tracking-tight text-slate-800">{stocks[s] ? stocks[s]!.price.toFixed(2) : '--.--'}</span><span className="text-slate-400 text-xs font-mono font-bold">CNY</span></div><div className="mt-5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${s === symbols[0] ? 'bg-indigo-500' : 'bg-teal-500'} opacity-30 w-full animate-pulse`} /></div></div>))}
        </div>

        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                {viewType === 'minute' ? <Clock className="w-5 h-5 text-indigo-500" /> : <Calendar className="w-5 h-5 text-indigo-500" />}
                {viewType === 'minute' ? '分时价差走势' : '历史收盘价差'}
              </h2>
              <p className="text-slate-400 text-xs mt-1 font-medium">{viewType === 'minute' ? '当天每分钟基准对冲分析' : '近30个交易日每日收盘价差轨迹'}</p>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100"><div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(79,70,229,0.3)]" /><span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">对冲价差曲线</span></div>
          </div>
          
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs><linearGradient id="colorDiff" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} interval={viewType === 'minute' ? 'preserveStartEnd' : 0} minTickGap={viewType === 'minute' ? 30 : 5} dy={15} />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                <Tooltip content={<CustomTooltip symbols={symbols} stocks={stocks} />} cursor={{ stroke: '#6366f1', strokeWidth: 1.5, strokeDasharray: '4 4' }} />
                <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="5 5" strokeWidth={1} />
                <Area type="monotone" dataKey="diff" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorDiff)" animationDuration={1200} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          {loading && (<div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-20"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-3 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" /><span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">加载引擎中...</span></div></div>)}
        </div>

        <footer className="pt-6 border-t border-slate-200">
           <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              <div>© 2026 专家级跨股对冲分析终端</div>
              <div className="flex items-center gap-4"><span className="hover:text-indigo-600 cursor-help transition-colors">实时对冲引擎集成</span><span className="w-1 h-1 bg-slate-200 rounded-full" /><span className="hover:text-indigo-600 cursor-help transition-colors">数据处理: ISO-GRID 对准算法</span></div>
           </div>
        </footer>

      </div>
    </div>
  );
}
