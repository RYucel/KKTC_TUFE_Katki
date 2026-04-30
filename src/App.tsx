/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  UploadCloud, CheckCircle, FileText, RefreshCw, BarChart3, TrendingUp, AlertTriangle, Calendar, PieChart, Search
} from 'lucide-react';

interface ItemContribution {
  item: string;
  weight: number;
  price0: number;
  pricePrev: number;
  priceCurr: number;
  cpiContribution: number;
  monthlyEffect: number;
}

interface CpiResult {
  date: string;
  cpi: number;
  monthlyChange: number;
  annualChange: number;
  itemContributions: ItemContribution[];
}

export default function App() {
  const [pricesFile, setPricesFile] = useState<File | null>(null);
  const [weightsFile, setWeightsFile] = useState<File | null>(null);
  const [results, setResults] = useState<CpiResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<'overview' | 'contributions'>('overview');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const handleProcess = async () => {
    if (!pricesFile || !weightsFile) {
      setError("Lütfen hem fiyatlar hem de ağırlıklar dosyasını yükleyin.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const [pricesData, weightsData] = await Promise.all([
        parseCSV(pricesFile),
        parseCSV(weightsFile)
      ]);

      const cpiResults = calculateCPI(pricesData, weightsData);
      setResults(cpiResults);
      if (cpiResults.length > 0) {
        setSelectedDate(cpiResults[cpiResults.length - 1].date);
        setActiveTab('overview');
      }
    } catch (err: any) {
      setError(err.message || "Dosyalar işlenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const parseCSV = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        }
      });
    });
  };

  const calculateCPI = (pricesReq: any[], weightsReq: any[]): CpiResult[] => {
    // 1. Process weights
    const weightMap: Record<string, number> = {};
    weightsReq.forEach((row) => {
      const item = row["Item name"]?.trim();
      const weightStr = row["Weights"] || row["Ağırlıklar"] || Object.values(row)[Object.keys(row).length - 1] as string;
      if (item && weightStr) {
        const w = parseFloat(weightStr.toString().replace(',', '.'));
        if (!isNaN(w)) {
          weightMap[item] = w;
        }
      }
    });

    const items = Object.keys(weightMap);
    if(items.length === 0) throw new Error("Ağırlıklar dosyasında ürün bulunamadı. Lütfen doğru dosyayı yüklediğinizden emin olun ('Item name' ve 'Weights' kolonları gereklidir).");

    // 2. Identify date column in prices
    const priceDateCol = Object.keys(pricesReq[0])[0];
    const validPrices = pricesReq.filter(r => r[priceDateCol] && r[priceDateCol].trim().length > 0);

    // 3. Base prices (Average of 2015)
    const prices2015 = validPrices.filter(r => {
      const date = r[priceDateCol].toString();
      return date.includes('-15') || date.includes('2015') || date.endsWith('15');
    });

    if (prices2015.length === 0) {
      throw new Error("2015 (Temel Yıl) verisi bulunamadı! Fiyat dosyanızda 2015 yılına ait veriler (örn: Jan-15) olduğundan emin olun.");
    }

    const basePrices: Record<string, number> = {};
    items.forEach(item => {
      let sum = 0;
      let count = 0;
      prices2015.forEach(row => {
        const pStr = row[item];
        if (pStr !== undefined && pStr !== null && pStr !== '') {
          const p = parseFloat(pStr.toString().replace(',', '.'));
          if (!isNaN(p)) {
            sum += p;
            count++;
          }
        }
      });
      if (count > 0) {
        basePrices[item] = sum / count;
      }
    });

    let activeWeight = 0;
    items.forEach(item => {
      if (basePrices[item] !== undefined) {
        activeWeight += weightMap[item];
      }
    });

    if (activeWeight === 0) {
      throw new Error("Eşleşen ürün bulunamadı. Fiyatlar ve Ağırlıklar dosyasındaki ürün isimlerinin eşleştiğinden emin olun.");
    }

    // 4. Calculate indices
    const calculatedResults: CpiResult[] = [];

    for (let i = 0; i < validPrices.length; i++) {
        const row = validPrices[i];
        const dateStr = row[priceDateCol].toString().trim();
        if (dateStr === "Date" || dateStr === "Item name" || dateStr.toLowerCase().includes('item name')) continue;

        let indexSum = 0;
        let matchedWeight = 0;
        const itemContributions: ItemContribution[] = [];
        
        items.forEach(item => {
            const pStr = row[item];
            const p0 = basePrices[item];
            const w = weightMap[item];

            if (p0 && pStr !== undefined && pStr !== null && pStr !== '') {
                const p = parseFloat(pStr.toString().replace(',', '.'));
                if (!isNaN(p) && p !== 0) {
                    indexSum += (p / p0) * w;
                    matchedWeight += w;

                    let pPrev = 0;
                    if (calculatedResults.length > 0) {
                       const prevRow = validPrices[i-1];
                       if (prevRow) {
                           const prevStr = prevRow[item];
                           if (prevStr !== undefined && prevStr !== null && prevStr !== '') {
                               pPrev = parseFloat(prevStr.toString().replace(',', '.'));
                           }
                       }
                    }

                    itemContributions.push({
                        item,
                        weight: w,
                        price0: p0,
                        pricePrev: isNaN(pPrev) ? 0 : pPrev,
                        priceCurr: p,
                        cpiContribution: 0,
                        monthlyEffect: 0
                    });
                }
            }
        });

        if (matchedWeight > 0) {
            const cpi = (indexSum / matchedWeight) * 100;
            const prevCpi = calculatedResults.length > 0 ? calculatedResults[calculatedResults.length - 1].cpi : cpi;
            
            let monthlyChange = 0;
            let annualChange = 0;

            if (calculatedResults.length > 0) {
                monthlyChange = ((cpi / prevCpi) - 1) * 100;
            }

            if (calculatedResults.length >= 12) {
                annualChange = ((cpi / calculatedResults[calculatedResults.length - 12].cpi) - 1) * 100;
            }

            itemContributions.forEach(ic => {
                ic.cpiContribution = ((ic.priceCurr / ic.price0) * ic.weight / matchedWeight) * 100;
                if (calculatedResults.length > 0 && ic.pricePrev > 0) {
                    const prevCpiContribution = ((ic.pricePrev / ic.price0) * ic.weight / matchedWeight) * 100;
                    const deltaCpi = ic.cpiContribution - prevCpiContribution;
                    ic.monthlyEffect = (deltaCpi / prevCpi) * 100;
                }
            });

            calculatedResults.push({
                date: dateStr,
                cpi,
                monthlyChange,
                annualChange,
                itemContributions
            });
        }
    }

    return calculatedResults;
  };

  const handleReset = () => {
    setPricesFile(null);
    setWeightsFile(null);
    setResults([]);
    setError(null);
    setSelectedDate(null);
    setSearchTerm('');
  };

  const selectedResult = useMemo(() => {
    return results.find(r => r.date === selectedDate) || null;
  }, [results, selectedDate]);

  const filteredContributions = useMemo(() => {
    if (!selectedResult) return [];
    let items = [...selectedResult.itemContributions];
    if (searchTerm) {
      items = items.filter(i => i.item.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return items.sort((a, b) => b.monthlyEffect - a.monthlyEffect);
  }, [selectedResult, searchTerm]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-6 sm:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">TÜFE Hesaplama Sistemi</h1>
            <p className="text-gray-500 mt-2">2015 Temel Yıllı Enflasyon (TÜFE), Değişim Oranı ve Ürün Katkıları Hesaplaması</p>
          </div>
          {results.length > 0 && (
            <button 
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Yeni Hesaplama
            </button>
          )}
        </header>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        {results.length === 0 ? (
          <main className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Prices Upload */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Fiyat Verileri (CSV)</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-sm">
                Sütunlarında ürün isimleri, satırlarında tarihler ("Jan-15" vb.) olan fiyat dosyasını yükleyin.
              </p>
              <label className="relative cursor-pointer bg-white px-5 py-2.5 border border-gray-300 rounded-lg shadow-sm font-medium text-sm text-gray-700 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 transition-colors">
                <span>{pricesFile ? pricesFile.name : "Fiyat Dosyası Seç"}</span>
                <input 
                  type="file" 
                  accept=".csv" 
                  className="sr-only" 
                  onChange={(e) => setPricesFile(e.target.files?.[0] || null)}
                />
              </label>
              {pricesFile && <p className="mt-3 flex items-center gap-1.5 text-sm text-green-600 font-medium"><CheckCircle className="w-4 h-4"/> Yüklendi</p>}
            </div>

            {/* Weights Upload */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <BarChart3 className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ağırlık Verileri (CSV)</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-sm">
                Sütunlarında "Item name" ve "Weights" bulunan ürün ağırlıkları dosyasını yükleyin.
              </p>
              <label className="relative cursor-pointer bg-white px-5 py-2.5 border border-gray-300 rounded-lg shadow-sm font-medium text-sm text-gray-700 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 transition-colors">
                <span>{weightsFile ? weightsFile.name : "Ağırlık Dosyası Seç"}</span>
                <input 
                  type="file" 
                  accept=".csv" 
                  className="sr-only" 
                  onChange={(e) => setWeightsFile(e.target.files?.[0] || null)}
                />
              </label>
              {weightsFile && <p className="mt-3 flex items-center gap-1.5 text-sm text-green-600 font-medium"><CheckCircle className="w-4 h-4"/> Yüklendi</p>}
            </div>

            <div className="col-span-1 md:col-span-2 flex justify-center mt-4">
              <button 
                onClick={handleProcess}
                disabled={!pricesFile || !weightsFile || loading}
                className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? <RefreshCw className="w-5 h-5 animate-spin"/> : <BarChart3 className="w-5 h-5" />}
                TÜFE Hesapla
              </button>
            </div>
          </main>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Tab Navigation */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`${
                    activeTab === 'overview'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Genel Görünüm
                </button>
                <button
                  onClick={() => setActiveTab('contributions')}
                  className={`${
                    activeTab === 'contributions'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
                >
                  <PieChart className="w-4 h-4" />
                  Ürün Katkıları
                </button>
              </nav>
            </div>

            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <span className="text-sm font-semibold text-gray-500 tracking-wide uppercase flex items-center gap-2"><Calendar className="w-4 h-4"/> Son Veri (TÜFE)</span>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-4xl font-bold tracking-tight text-gray-900">{results[results.length - 1].cpi.toFixed(2)}</span>
                      <span className="text-sm font-medium text-gray-500">({results[results.length - 1].date})</span>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <span className="text-sm font-semibold text-gray-500 tracking-wide uppercase flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Aylık Değişim</span>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className={`text-4xl font-bold tracking-tight ${results[results.length - 1].monthlyChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {results[results.length - 1].monthlyChange > 0 ? '+' : ''}{results[results.length - 1].monthlyChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col">
                    <span className="text-sm font-semibold text-gray-500 tracking-wide uppercase flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Yıllık Değişim</span>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className={`text-4xl font-bold tracking-tight ${results[results.length - 1].annualChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {results[results.length - 1].annualChange > 0 ? '+' : ''}{results[results.length - 1].annualChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">TÜFE Gelişimi (2015=100)</h2>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={results} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fontSize: 12, fill: '#6B7280' }} 
                          tickLine={false} 
                          axisLine={false} 
                          dy={10}
                          minTickGap={30}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          tick={{ fontSize: 12, fill: '#6B7280' }} 
                          tickLine={false} 
                          axisLine={false} 
                          dx={-10}
                          tickFormatter={(val) => Math.round(val).toString()}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => [value.toFixed(2), 'TÜFE']}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="cpi" 
                          stroke="#3B82F6" 
                          strokeWidth={3} 
                          dot={false}
                          activeDot={{ r: 6, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tarih</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">TÜFE Değeri (2015=100)</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Aylık Değişim (%)</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Yıllık Değişim (%)</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {[...results].reverse().map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.date}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{row.cpi.toFixed(2)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-right ${row.monthlyChange > 0 ? 'text-green-600' : row.monthlyChange < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                              {row.monthlyChange > 0 ? '+' : ''}{row.monthlyChange.toFixed(2)}%
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-right ${row.annualChange > 0 ? 'text-green-600' : row.annualChange < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                              {row.annualChange > 0 ? '+' : ''}{row.annualChange.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'contributions' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                  <div className="w-full sm:w-64">
                    <label htmlFor="period-select" className="block text-sm font-medium text-gray-700 mb-1">Dönem Seçimi</label>
                    <select
                      id="period-select"
                      value={selectedDate || ''}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md border"
                    >
                      {[...results].reverse().map(r => (
                        <option key={r.date} value={r.date}>{r.date}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="w-full sm:w-72">
                    <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">Ürün Ara</label>
                    <div className="relative rounded-md shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
                      </div>
                      <input
                        type="text"
                        name="search"
                        id="search"
                        className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md border py-2"
                        placeholder="Örn: Ekmek, Benzin..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-base font-semibold text-gray-900">
                      {selectedResult?.date} Aylık Enflasyon Etkileri
                    </h3>
                    <div className="text-sm font-medium">
                      Aylık Değişim: <span className={selectedResult && selectedResult.monthlyChange > 0 ? "text-green-600" : "text-red-500"}>
                        {selectedResult && selectedResult.monthlyChange > 0 ? '+' : ''}{selectedResult?.monthlyChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[600px]">
                    <table className="min-w-full divide-y divide-gray-200 relative">
                      <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Ürün Adı</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Sepet Ağırlığı</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Önceki Fiyat</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Cari Fiyat</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Fiyat Değişimi</th>
                          <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Enflasyona Katkı (Puan)</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredContributions.map((item, idx) => {
                          const priceChangePct = item.pricePrev ? ((item.priceCurr / item.pricePrev) - 1) * 100 : 0;
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{item.item}</td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500 text-right">{item.weight.toFixed(4)}</td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500 text-right">{item.pricePrev.toFixed(2)}</td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{item.priceCurr.toFixed(2)}</td>
                              <td className={`px-6 py-3 whitespace-nowrap text-sm text-right font-medium ${priceChangePct > 0 ? 'text-orange-500' : priceChangePct < 0 ? 'text-green-500' : 'text-gray-500'}`}>
                                {priceChangePct > 0 ? '+' : ''}{priceChangePct.toFixed(2)}%
                              </td>
                              <td className={`px-6 py-3 whitespace-nowrap text-sm text-right font-bold ${item.monthlyEffect > 0 ? 'text-red-600' : item.monthlyEffect < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                {item.monthlyEffect > 0 ? '+' : ''}{item.monthlyEffect.toFixed(3)}
                              </td>
                            </tr>
                          );
                        })}
                        {filteredContributions.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-10 text-center text-gray-500 text-sm">
                              Ürün bulunamadı.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}


