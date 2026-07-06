import React, { useState, useEffect } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product } from '../../types';
import { LOCALES } from './mobileLocales';

interface HomeScreenProps {
  onCustomize: (product: Product) => void;
  onOpenBranchModal: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onCustomize, onOpenBranchModal }) => {
  const { products, categories, selectedBranch, isProductAvailableInBranch, mobileLang } = useApp();
  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);

  // Auto scroll banners
  useEffect(() => {
    const timer = setInterval(() => setActiveBannerIndex(prev => (prev + 1) % 3), 4500);
    return () => clearInterval(timer);
  }, []);

  // Filter products by search and category
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.nameAr.includes(searchQuery);
    const matchesCategory = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const isAvailableInBranch = selectedBranch ? isProductAvailableInBranch(p.id, selectedBranch.id) : true;
    return matchesSearch && matchesCategory && p.isActive && isAvailableInBranch;
  });

  return (
    <>
            <div className="animate-fade-in">
              
              {/* Branch Selector Alert Header if none active */}
              {!selectedBranch && (
                <div className="m-3 p-3 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-800 font-bold">{t.select_branch}</p>
                  </div>
                  <button 
                    onClick={() => onOpenBranchModal()}
                    className="text-[10px] bg-red-600 text-white font-bold py-1 px-2.5 rounded-full"
                  >
                    {t.select_branch}
                  </button>
                </div>
              )}

              {/* Dynamic Banners Slider */}
              <div className="relative mx-4 mt-3 h-[130px] rounded-2xl overflow-hidden shadow-sm">
                <img 
                  src={activeBannerIndex === 0 
                    ? 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&h=400&q=80' 
                    : activeBannerIndex === 1
                    ? 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&h=400&q=80'
                    : 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&h=400&q=80'
                  } 
                  alt="spicy promotion banner" 
                  className="w-full h-full object-cover brightness-75"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex flex-col justify-end">
                  <div className="bg-secondary text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded self-start mb-1 tracking-widest">
                    PROMO HOT DEAL
                  </div>
                  <h3 className="text-white text-sm font-black tracking-tight line-clamp-1">
                    {isRTL 
                      ? (activeBannerIndex === 0 
                        ? 'ضعف الحرارة، ضعف النكهة الرائعة!' 
                        : activeBannerIndex === 1
                        ? 'برجر سموكي أنجوس البقري المدخن الفاخر!'
                        : 'جديد: ميلك شيك فراولة بنكهة دافئة مميزة')
                      : (activeBannerIndex === 0 
                        ? 'Double The Heat, Double The Flavor!' 
                        : activeBannerIndex === 1
                        ? 'Halal Bacon Smokey Angus Launch!'
                        : 'Spiced Strawberry Milkshakes')
                    }
                  </h3>
                </div>
                {/* Dots indicator */}
                <div className={`absolute bottom-2 ${isRTL ? 'left-3' : 'right-3'} flex gap-1 z-10`}>
                  {[0, 1, 2].map(i => (
                    <div 
                      key={i} 
                      className={`w-1.5 h-1.5 rounded-full transition-all ${i === activeBannerIndex ? 'bg-secondary w-3' : 'bg-white/50'}`}
                    ></div>
                  ))}
                </div>
              </div>

              {/* Welcome text & Search */}
              <div className="px-4 mt-4">
                <h2 className="text-base font-black text-gray-900">{t.welcome}</h2>
                {selectedBranch && (
                  <p className="text-[11px] text-gray-500 font-medium">
                    {t.active_branch}: <span className="font-bold text-primary">{isRTL ? selectedBranch.nameAr : selectedBranch.nameEn}</span>
                  </p>
                )}

                {/* Live Search bar */}
                <div className="mt-2.5 relative flex items-center">
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.search_food}
                    className="glass-input w-full text-xs rounded-full py-2.5 px-4 outline-none text-slate-800"
                  />
                </div>
              </div>

              {/* Category Pills Slider */}
              <div className="mt-4 px-4">
                <h3 className="text-xs font-black text-gray-700 uppercase tracking-wider mb-2">{t.categories}</h3>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  <button 
                    onClick={() => setSelectedCategory('all')}
                    className={`text-xs px-4 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors ${selectedCategory === 'all' ? 'glass-btn-primary text-white shadow-sm' : 'glass-btn-outline'}`}
                  >
                    {isRTL ? 'الكل' : 'All Menu'}
                  </button>
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`text-xs px-4 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors ${selectedCategory === cat.id ? 'glass-btn-primary text-white shadow-sm' : 'glass-btn-outline'}`}
                    >
                      {isRTL ? cat.nameAr : cat.nameEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Menu Product Cards */}
              <div className="mt-3 px-4 grid grid-cols-2 gap-3 pb-8">
                {filteredProducts.map(product => (
                  <div 
                    key={product.id}
                    className="glass-card rounded-2xl overflow-hidden flex flex-col hover:shadow-md transition-all cursor-pointer"
                    onClick={() => onCustomize(product)}
                  >
                    <div className="relative h-[100px] w-full bg-gray-50">
                      <img 
                        src={product.imageUrl} 
                        alt={product.nameEn}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className={`absolute top-1.5 ${isRTL ? 'left-1.5' : 'right-1.5'} bg-black/65 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full`}>
                        {product.calories} {t.calories}
                      </div>
                    </div>
                    
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-black text-gray-950 leading-tight line-clamp-1">
                          {isRTL ? product.nameAr : product.nameEn}
                        </h4>
                        <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2 leading-snug">
                          {isRTL ? product.descriptionAr : product.descriptionEn}
                        </p>
                      </div>

                      <div className="mt-2.5 pt-1.5 border-t border-gray-50 flex items-center justify-between">
                        <span className="text-xs font-black text-secondary">
                          {product.price} {t.sar}
                        </span>
                        <div className="w-6 h-6 rounded-full bg-primary/10 hover:bg-primary text-primary hover:text-white flex items-center justify-center transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="col-span-2 py-8 flex flex-col items-center justify-center text-center">
                    <AlertCircle className="w-8 h-8 text-gray-300 mb-1" />
                    <p className="text-xs font-semibold text-gray-400">
                      {isRTL ? 'عذراً، لا توجد وجبات متاحة حالياً لتصنيفك أو فرعك المحدد.' : 'Sorry, no active products in this category for the selected branch.'}
                    </p>
                  </div>
                )}
              </div>

            </div>
    </>
  );
};
