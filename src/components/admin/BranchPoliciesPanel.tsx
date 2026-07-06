import React from 'react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';

export const BranchPoliciesPanel: React.FC = () => {
  const { branches, products, updateBranchSettings, isProductAvailableInBranch, toggleProductAvailability, currentUser, adminLang } = useApp();
  const isAccountant = currentUser.role === 'accountant';
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  return (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">{t.branch_tab}</h3>

              {/* Grid layout of Branches */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {branches.map(branch => (
                  <div key={branch.id} className="glass-card p-3.5 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-black text-gray-900">{isRTL ? branch.nameAr : branch.nameEn}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{isRTL ? branch.addressAr : branch.addressEn}</p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {branch.isActive ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>

                    {/* Operational parameters toggles */}
                    <div className="pt-2 border-t border-slate-200/50 text-[10px] text-gray-600 space-y-2">
                      <div className="flex justify-between items-center">
                        <span>{t.delivery_fee}:</span>
                        <input 
                          type="number"
                          disabled={isAccountant}
                          value={branch.deliveryFee}
                          onChange={(e) => updateBranchSettings(branch.id, { deliveryFee: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span>{t.min_order}:</span>
                        <input 
                          type="number"
                          disabled={isAccountant}
                          value={branch.minDeliveryOrder}
                          onChange={(e) => updateBranchSettings(branch.id, { minDeliveryOrder: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>

                      {/* Manual open close switch toggle */}
                      <button 
                        onClick={() => updateBranchSettings(branch.id, { isActive: !branch.isActive })}
                        disabled={isAccountant}
                        className={`w-full py-1.5 rounded text-center text-[9px] font-black uppercase transition-all disabled:opacity-50 ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                      >
                        {branch.isActive ? 'Close Branch Maintenance' : 'Open Branch Operational'}
                      </button>
                    </div>

                    {/* Custom Product Availability Sub Matrix */}
                    <div className="pt-2 border-t border-slate-200/50 space-y-1.5">
                      <span className="block text-[9px] text-gray-400 font-bold uppercase mb-1">{isRTL ? 'توفر الوجبات الفوري بالفرع:' : 'Branch Product Stock Availability:'}</span>
                      <div className="space-y-1 max-h-[140px] overflow-y-auto">
                        {products.map(p => {
                          const isAvailable = isProductAvailableInBranch(p.id, branch.id);
                          return (
                            <div key={p.id} className="flex justify-between items-center p-1.5 bg-white/30 rounded-lg text-[9.5px]">
                              <span className="font-semibold text-gray-700 truncate max-w-[130px]">{isRTL ? p.nameAr : p.nameEn}</span>
                              <button 
                                onClick={() => toggleProductAvailability(p.id, branch.id)}
                                disabled={isAccountant || !branch.isActive}
                                className={`text-[8px] font-black px-2 py-0.5 rounded uppercase disabled:opacity-50 ${isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                              >
                                {isAvailable ? 'Available' : 'Sold Out'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            </div>
  );
};
