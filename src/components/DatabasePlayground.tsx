/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Database, FileCode, Server, ListCollapse, RefreshCw, KeyRound, Info, Eye } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const DatabasePlayground: React.FC = () => {
  const {
    branches, categories, products, orders, addresses, profiles
  } = useApp();

  const [activeTable, setActiveTable] = useState<'branches' | 'categories' | 'products' | 'orders' | 'addresses' | 'profiles'>('products');
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  const getTableRows = () => {
    switch (activeTable) {
      case 'branches': return branches;
      case 'categories': return categories;
      case 'products': return products;
      case 'orders': return orders;
      case 'addresses': return addresses;
      case 'profiles': return profiles;
      default: return [];
    }
  };

  const rows = getTableRows();

  return (
    <div className="flex-1 glass-panel-dark text-slate-100 rounded-2xl p-5 border border-white/10 shadow-2xl font-mono flex flex-col h-full min-h-[600px]">
      
      {/* Console Top Header */}
      <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-secondary animate-pulse" />
          <div>
            <h2 className="text-sm font-black text-white tracking-wide">SUPABASE DATABASE CONSOLE (EMULATED)</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Connected Schema: postgresql://postgres:spicymeal-db@localhost:5432/main</p>
          </div>
        </div>

        {/* View togglers JSON vs Table */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button 
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded font-black text-[10px] ${viewMode === 'table' ? 'bg-primary text-white' : 'text-slate-400'}`}
            >
              TABLE VIEW
            </button>
            <button 
              onClick={() => setViewMode('json')}
              className={`px-3 py-1 rounded font-black text-[10px] ${viewMode === 'json' ? 'bg-primary text-white' : 'text-slate-400'}`}
            >
              RAW JSON
            </button>
          </div>
          <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-extrabold px-2.5 py-1 rounded-lg">
            ● SYSTEM ACTIVE
          </span>
        </div>
      </div>

      {/* RLS warning information row */}
      <div className="mt-3 bg-slate-900/40 border border-slate-800/80 rounded-xl p-3 flex items-start gap-2.5 text-[10px] text-slate-300">
        <KeyRound className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5" />
        <div className="leading-normal">
          <span className="font-bold text-white">Row Level Security (RLS) policies are active on this schema:</span>
          <p className="text-slate-400 mt-0.5">
            - <code className="text-secondary font-black">branches</code>, <code className="text-secondary font-black">products</code>: READ is granted publicly to everyone; UPDATE is restricted to <code className="text-purple-400">role = 'admin'</code>.<br/>
            - <code className="text-secondary font-black">orders</code>, <code className="text-secondary font-black">addresses</code>: Select is isolated by <code className="text-purple-400">auth.uid() = customer_id</code>. Admin bypassing overrides RLS.
          </p>
        </div>
      </div>

      {/* Row: Tables selectors and Table content */}
      <div className="flex-grow flex flex-col md:flex-row mt-4 gap-4 overflow-hidden">
        
        {/* Left Tables Sidebar */}
        <div className="w-full md:w-[190px] flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          {[
            { key: 'branches', label: 'public.branches', count: branches.length },
            { key: 'categories', label: 'public.categories', count: categories.length },
            { key: 'products', label: 'public.products', count: products.length },
            { key: 'orders', label: 'public.orders', count: orders.length },
            { key: 'addresses', label: 'public.addresses', count: addresses.length },
            { key: 'profiles', label: 'public.profiles', count: profiles.length }
          ].map(table => (
            <button 
              key={table.key}
              onClick={() => setActiveTable(table.key as any)}
              className={`w-full text-left flex justify-between items-center text-[11px] py-2 px-3 rounded-lg border transition-all ${
                activeTable === table.key 
                  ? 'bg-primary/20 border-primary text-white font-black' 
                  : 'bg-slate-900/40 border-slate-800/50 text-slate-400 hover:bg-slate-900/80 hover:text-white'
              }`}
            >
              <span>{table.label}</span>
              <span className="text-[9px] font-bold opacity-60">[{table.count}]</span>
            </button>
          ))}
        </div>

        {/* Right Content Editor viewport */}
        <div className="flex-grow bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          
          {viewMode === 'table' ? (
            /* CONSOLE RENDER TABLE LAYOUT */
            <div className="flex-1 overflow-auto max-h-[350px]">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs font-black">
                  [EMPTY TABLE - NO RECORDS AVAILABLE]
                </div>
              ) : (
                <table className="w-full text-[10.5px] text-slate-300 text-left">
                  <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 uppercase font-black tracking-wide text-[9.5px]">
                    {activeTable === 'branches' && (
                      <tr>
                        <th className="px-3 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Name (EN)</th>
                        <th className="px-3 py-2.5">Phone</th>
                        <th className="px-3 py-2.5">Delivery Fee</th>
                        <th className="px-3 py-2.5">Active</th>
                      </tr>
                    )}
                    {activeTable === 'categories' && (
                      <tr>
                        <th className="px-3 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Name (EN)</th>
                        <th className="px-3 py-2.5">Name (AR)</th>
                        <th className="px-3 py-2.5">Sort Order</th>
                      </tr>
                    )}
                    {activeTable === 'products' && (
                      <tr>
                        <th className="px-3 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Name (EN)</th>
                        <th className="px-3 py-2.5">Category ID</th>
                        <th className="px-3 py-2.5">Price (SAR)</th>
                        <th className="px-3 py-2.5">Calories</th>
                      </tr>
                    )}
                    {activeTable === 'orders' && (
                      <tr>
                        <th className="px-3 py-2.5">Order No</th>
                        <th className="px-3 py-2.5">Customer</th>
                        <th className="px-3 py-2.5">Total</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">POS Sync</th>
                      </tr>
                    )}
                    {activeTable === 'addresses' && (
                      <tr>
                        <th className="px-3 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Label</th>
                        <th className="px-3 py-2.5">Description</th>
                        <th className="px-3 py-2.5">Short Code</th>
                      </tr>
                    )}
                    {activeTable === 'profiles' && (
                      <tr>
                        <th className="px-3 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Full Name</th>
                        <th className="px-3 py-2.5">Phone</th>
                        <th className="px-3 py-2.5">Role</th>
                        <th className="px-3 py-2.5">Loyalty Points</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {rows.map((row: any, idx: number) => (
                      <tr key={row.id || idx} className="hover:bg-slate-900/50">
                        {activeTable === 'branches' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black truncate max-w-[80px]">{row.id}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{row.nameEn}</td>
                            <td className="px-3 py-2.5">{row.phone}</td>
                            <td className="px-3 py-2.5 text-secondary font-black">{row.deliveryFee.toFixed(2)} SAR</td>
                            <td className="px-3 py-2.5">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${row.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                {row.isActive ? 'TRUE' : 'FALSE'}
                              </span>
                            </td>
                          </>
                        )}
                        {activeTable === 'categories' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black truncate max-w-[80px]">{row.id}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{row.nameEn}</td>
                            <td className="px-3 py-2.5">{row.nameAr}</td>
                            <td className="px-3 py-2.5">{row.sortOrder}</td>
                          </>
                        )}
                        {activeTable === 'products' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black truncate max-w-[80px]">{row.id}</td>
                            <td className="px-3 py-2.5 font-bold text-white truncate max-w-[120px]">{row.nameEn}</td>
                            <td className="px-3 py-2.5 text-slate-400 truncate max-w-[100px]">{row.categoryId}</td>
                            <td className="px-3 py-2.5 text-secondary font-black">{row.price.toFixed(2)}</td>
                            <td className="px-3 py-2.5">{row.calories} kcal</td>
                          </>
                        )}
                        {activeTable === 'orders' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black">{row.orderNumber}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{row.customerName}</td>
                            <td className="px-3 py-2.5 text-secondary font-black">{row.total.toFixed(2)} SAR</td>
                            <td className="px-3 py-2.5">
                              <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase ${row.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-bold text-purple-400">{row.orderSyncStatus}</td>
                          </>
                        )}
                        {activeTable === 'addresses' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black truncate max-w-[80px]">{row.id}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{row.label}</td>
                            <td className="px-3 py-2.5 truncate max-w-[150px]">{row.description}</td>
                            <td className="px-3 py-2.5 text-purple-400 font-bold">{row.nationalShortAddress}</td>
                          </>
                        )}
                        {activeTable === 'profiles' && (
                          <>
                            <td className="px-3 py-2.5 text-primary font-black truncate max-w-[80px]">{row.id}</td>
                            <td className="px-3 py-2.5 font-bold text-white">{row.fullName}</td>
                            <td className="px-3 py-2.5">{row.phoneNumber}</td>
                            <td className="px-3 py-2.5">
                              <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-[8px] font-black uppercase">
                                {row.role}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-purple-400 font-extrabold font-mono text-[10px]">
                              {row.role === 'customer' ? `${row.loyaltyPoints || 0} pts` : '-'}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* CONSOLE RENDER JSON VIEW */
            <div className="flex-1 p-4 overflow-auto max-h-[350px]">
              <pre className="text-[10px] text-purple-300 leading-normal select-text whitespace-pre-wrap">
                {JSON.stringify(rows, null, 2)}
              </pre>
            </div>
          )}

        </div>

      </div>

      {/* SQL Quick Terminal Footer display */}
      <div className="border-t border-slate-800 pt-3 mt-4 text-[9px] text-slate-400 flex justify-between">
        <span>SQL Query Executed: SELECT * FROM public.{activeTable};</span>
        <span>Row Fetch Time: 0.001s</span>
      </div>

    </div>
  );
};
