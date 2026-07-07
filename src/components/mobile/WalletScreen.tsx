import React, { useState } from 'react';
import { Award, History, Wallet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatRiyadhDateTime, formatSAR } from '../../utils/calculations';
import { LOCALES } from './mobileLocales';

interface WalletScreenProps {
  isLoggedIn: boolean;
  onNavigate: (tab: 'home' | 'cart' | 'wallet' | 'profile') => void;
  onToast: (msg: string) => void;
}

export const WalletScreen: React.FC<WalletScreenProps> = ({ isLoggedIn, onNavigate, onToast }) => {
  const { currentUser, updateCustomerPoints, loyaltyPointsRedeemed, setLoyaltyPointsRedeemed, loyaltySettings, walletCreditEnabled, orders, mobileLang } = useApp();
  const t = LOCALES[mobileLang];
  const isRTL = mobileLang === 'ar';
  const [walletBalance, setWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem('sm_wallet_balance');
    return saved ? Number(saved) : 25.00;
  });

  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      // Release the context once the ping ends to avoid leaking one AudioContext
      // per call (browsers cap the number of live contexts).
      osc.onended = () => { ctx.close().catch(() => {}); };
    } catch (e) {
      // Ignore audio fail
    }
  };

  const handleConvertPoints = (ptsToDeduct: number, cashToAdd: number) => {
    if ((currentUser.loyaltyPoints || 0) < ptsToDeduct) return;
    const nextPoints = (currentUser.loyaltyPoints || 0) - ptsToDeduct;
    updateCustomerPoints(currentUser.id, nextPoints);
    // Points just spent on wallet credit can no longer back a staged checkout
    // discount — drop the staged redemption if it now exceeds the balance.
    if (loyaltyPointsRedeemed > nextPoints) setLoyaltyPointsRedeemed(0);
    const nextBalance = walletBalance + cashToAdd;
    setWalletBalance(nextBalance);
    localStorage.setItem('sm_wallet_balance', String(nextBalance));
    
    playNotificationSound();
    
    onToast(mobileLang === 'en' 
      ? `🎉 Success! Converted ${ptsToDeduct} points to ${cashToAdd} SAR store credit!` 
      : `🎉 تم تحويل ${ptsToDeduct} نقطة إلى ${cashToAdd} ر.س رصيد في محفظتك!`
    );
  };

  const handleClaimVoucher = (reward: any) => {
    if ((currentUser.loyaltyPoints || 0) < reward.points) return;
    const nextPoints = (currentUser.loyaltyPoints || 0) - reward.points;
    updateCustomerPoints(currentUser.id, nextPoints);
    // Same guard as wallet conversion: a staged checkout redemption cannot
    // outlive the points that funded it.
    if (loyaltyPointsRedeemed > nextPoints) setLoyaltyPointsRedeemed(0);

    playNotificationSound();
    
    const voucherCode = `SM-VOU-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    onToast(mobileLang === 'en'
      ? `🎁 Success! Generated code: [${voucherCode}] for ${reward.nameEn}!`
      : `🎁 تم توليد كود المكافأة: [${voucherCode}] لـ ${reward.nameAr}!`
    );
  };

  const getLoyaltyLedger = () => {
    const ledger = [
      {
        titleEn: 'Welcome Bonus Points',
        titleAr: 'نقاط ترحيبية من الإدارة',
        date: '2026-07-01 12:00',
        points: 350
      }
    ];

    orders.filter(o => o.customerId === currentUser.id).forEach(order => {
      const orderPts = Math.floor(order.total * (loyaltySettings.pointsPerRiyal || 1));
      if (orderPts > 0) {
        ledger.push({
          titleEn: `Earned on order ${order.orderNumber}`,
          titleAr: `نقاط مكتسبة من الطلب رقم ${order.orderNumber}`,
          date: formatRiyadhDateTime(order.createdAt),
          points: orderPts
        });
      }
    });

    return ledger;
  };

  return (
    <>
            <div className="p-4 animate-fade-in pb-12 space-y-4">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-base font-black text-gray-900">{isRTL ? 'المحفظة والولاء' : 'Wallet & Loyalty'}</h2>
                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black uppercase">
                  {isRTL ? 'مكافآت حصرية' : 'Exclusive Rewards'}
                </span>
              </div>

              {!isLoggedIn ? (
                /* IF NOT LOGGED IN, SHOW PROMPT CARD TO LOG IN FOR LOYALTY */
                <div className="glass-card rounded-2xl p-6 text-center space-y-4">
                  <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto text-primary">
                    <Wallet className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-900">{isRTL ? 'افتح محفظتك الرقمية' : 'Unlock Your Digital Wallet'}</h3>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                      {isRTL 
                        ? 'سجل دخولك الآن لتجميع نقاط الولاء، الحصول على كاش باك فوري، واسترداد وجبات مجانية مكافأة لك!' 
                        : 'Sign in to accumulate loyalty points, earn instant cashback, and redeem delicious free meals!'}
                    </p>
                  </div>
                  <button 
                    onClick={() => onNavigate('profile')}
                    className="w-full bg-primary text-white text-xs font-black py-2.5 rounded-xl transition-all hover:scale-101"
                  >
                    {isRTL ? 'سجل دخولك الآن' : 'Go to Login'}
                  </button>
                </div>
              ) : (
                /* FULL LOYALTY SYSTEM AND WALLET DETAILS */
                <div className="space-y-4">
                  {/* Digital Loyalty Card Component */}
                  <div className="bg-gradient-to-br from-primary to-secondary text-white rounded-3xl p-4 shadow-lg relative overflow-hidden">
                    {/* Abstract background design blobs */}
                    <div className="absolute -right-8 -top-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
                    <div className="absolute -left-8 -bottom-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
                    
                    <div className="relative space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[9px] font-bold text-purple-200 uppercase tracking-widest block">
                            {isRTL ? 'بطاقة الولاء الرقمية الموحدة' : 'Unified Digital Loyalty Card'}
                          </span>
                          <h4 className="text-base font-black tracking-tight mt-0.5">
                            {currentUser.fullName}
                          </h4>
                          <span className="text-[8px] font-mono text-purple-200 block opacity-80 mt-0.5">
                            ID: SM-LOY-{currentUser.id.split('-')[1]?.toUpperCase() || 'CUST'}
                          </span>
                        </div>
                        <span className="text-[9px] font-black bg-white/20 px-2.5 py-1 rounded-full backdrop-blur-xs border border-white/10 uppercase">
                          {currentUser.loyaltyPoints >= 300 
                            ? (isRTL ? '👑 ذهبي' : '👑 Gold Tier') 
                            : currentUser.loyaltyPoints >= 100 
                            ? (isRTL ? '✨ فضي' : '✨ Silver Tier') 
                            : (isRTL ? '🥉 برونزي' : '🥉 Bronze Tier')}
                        </span>
                      </div>

                      <div className="flex justify-between items-end pt-1">
                        <div>
                          <span className="text-[8.5px] font-bold text-purple-100 uppercase block leading-none">
                            {isRTL ? 'رصيد نقاط الولاء' : 'Loyalty Points Balance'}
                          </span>
                          <div className="flex items-baseline gap-1.5 mt-1">
                            <span className="text-3xl font-black leading-none">{currentUser.loyaltyPoints || 0}</span>
                            <span className="text-xs font-bold text-purple-100">{isRTL ? 'نقطة' : 'pts'}</span>
                          </div>
                          <span className="text-[9.5px] text-purple-100 block mt-1">
                            (= {formatSAR((currentUser.loyaltyPoints || 0) * (loyaltySettings?.discountPerPoint || 0.1), mobileLang)} {isRTL ? 'رصيد مسترجع' : 'cashback credit'})
                          </span>
                        </div>

                        {/* Interactive Scan barcode/QR code for gamified scanning */}
                        <div className="bg-white p-1.5 rounded-xl flex flex-col items-center gap-1 shadow-md">
                          <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden border border-slate-200">
                            {/* Standard pixelated mini mock QR pattern */}
                            <div className="w-9 h-9 opacity-90" style={{
                              backgroundImage: `radial-gradient(circle, #000 25%, transparent 26%), radial-gradient(circle, #000 25%, transparent 26%)`,
                              backgroundSize: '6px 6px',
                              backgroundPosition: '0 0, 3px 3px'
                            }} />
                          </div>
                          <span className="text-[7px] text-primary font-mono font-black tracking-wide leading-none">POS_SCAN_EARN</span>
                        </div>
                      </div>

                      {/* Tier progress bar */}
                      <div className="space-y-1.5 pt-2 border-t border-white/10">
                        <div className="flex justify-between text-[9px] font-black text-purple-200">
                          <span>
                            {currentUser.loyaltyPoints >= 500 
                              ? (isRTL ? '🎁 مبروك! لقد فتحت الوجبة المجانية!' : '🎁 Unlocked Free Premium Meal!') 
                              : (isRTL ? `متبقي ${(500 - currentUser.loyaltyPoints)} نقطة لوجبة مجانية` : `${500 - currentUser.loyaltyPoints} pts to Free Premium Meal!`)}
                          </span>
                          <span>
                            {currentUser.loyaltyPoints} / 500
                          </span>
                        </div>
                        <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden p-0.5 border border-white/5">
                          <div 
                            className={`h-full rounded-full transition-all duration-700 ${
                              currentUser.loyaltyPoints >= 500 
                                ? 'bg-gradient-to-r from-amber-400 to-yellow-300' 
                                : 'bg-gradient-to-r from-primary to-yellow-400'
                            }`}
                            style={{ width: `${Math.min(100, (currentUser.loyaltyPoints / 500) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Cashback Conversion and Store Credit Module */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">{isRTL ? 'رصيد المحفظة النقدي' : 'Store Credit Wallet'}</h3>
                        <p className="text-[9px] text-gray-400 mt-0.5 leading-snug">{isRTL ? 'استبدل نقاطك إلى رصيد بالمحفظة واستخدمه عند الطلب!' : 'Convert points to cash credit in your wallet!'}</p>
                      </div>
                      <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 rounded-xl text-center">
                        <span className="text-[9px] font-bold block uppercase leading-none">{isRTL ? 'رصيد المحفظة' : 'Wallet Balance'}</span>
                        <span className="text-sm font-black text-emerald-600 font-mono mt-1 block leading-none">{formatSAR(walletBalance, mobileLang)}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        disabled={!walletCreditEnabled || currentUser.loyaltyPoints < 100}
                        onClick={() => handleConvertPoints(100, 10)}
                        className="flex-1 bg-slate-50 hover:bg-purple-50 text-primary border border-gray-100 hover:border-purple-200 rounded-xl p-2.5 text-center transition-all disabled:opacity-40"
                      >
                        <span className="block text-[11px] font-black">{isRTL ? 'تحويل ١٠٠ نقطة' : 'Convert 100 Pts'}</span>
                        <span className="block text-[9px] text-secondary font-bold mt-0.5">{isRTL ? 'للحصول على ١٠ ر.س' : 'Get 10 SAR'}</span>
                      </button>
                      <button
                        disabled={!walletCreditEnabled || currentUser.loyaltyPoints < 250}
                        onClick={() => handleConvertPoints(250, 30)}
                        className="flex-1 bg-slate-50 hover:bg-purple-50 text-primary border border-gray-100 hover:border-purple-200 rounded-xl p-2.5 text-center transition-all disabled:opacity-40"
                      >
                        <span className="block text-[11px] font-black">{isRTL ? 'تحويل ٢٥٠ نقطة' : 'Convert 250 Pts'}</span>
                        <span className="block text-[9px] text-secondary font-bold mt-0.5">{isRTL ? 'للحصول على ٣٠ ر.س' : 'Get 30 SAR'}</span>
                      </button>
                    </div>

                    {!walletCreditEnabled && (
                      <p className="text-[9.5px] text-slate-500 font-semibold text-center mt-1">
                        {isRTL ? 'استبدال النقاط غير متاح في هذه النسخة (عرض فقط)' : 'Point redemption is read-only in this build (display only)'}
                      </p>
                    )}
                  </div>

                  {/* Vouchers and Rewards Milestones */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1">
                      <Award className="w-4 h-4 text-secondary" />
                      <span>{isRTL ? 'مكافآت الولاء المتاحة للفتح' : 'Unlocked Rewards & Milestones'}</span>
                    </h3>

                    <div className="space-y-2">
                      {[
                        { id: 'rew-1', nameEn: 'Free Soft Drink', nameAr: 'مشروب غازي مجاني', points: 50, descEn: 'Any soda can from our spicy menu', descAr: 'أي علبة مشروب من قائمة الوجبات' },
                        { id: 'rew-2', nameEn: 'Free Spicy Fries', nameAr: 'بطاطس مقلية حارة مجانية', points: 100, descEn: 'Regular size crispy spiced fries', descAr: 'بطاطس مقلية متبلة بحجم عادي' },
                        { id: 'rew-3', nameEn: 'Free Chicken Burger', nameAr: 'برجر دجاج كلاسيك مجاني', points: 250, descEn: 'Signature classic crispy burger', descAr: 'برجر دجاج مقرمش كلاسيكي' },
                        { id: 'rew-4', nameEn: 'Free Spicy Feast', nameAr: 'وجبة الوليمة الحارة مجاناً', points: 500, descEn: 'Double meal combo with sides and drink', descAr: 'وجبة كومبو مزدوجة مع مقبلات ومشروب' }
                      ].map(reward => {
                        const isUnlocked = currentUser.loyaltyPoints >= reward.points;
                        return (
                          <div 
                            key={reward.id} 
                            className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                              isUnlocked 
                                ? 'bg-purple-50/40 border-purple-100 hover:border-purple-300' 
                                : 'bg-gray-50/50 border-gray-100 opacity-60'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-black ${isUnlocked ? 'text-gray-950' : 'text-gray-400'}`}>
                                  {isRTL ? reward.nameAr : reward.nameEn}
                                </span>
                                <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase ${
                                  isUnlocked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                                }`}>
                                  {isUnlocked ? (isRTL ? 'جاهز' : 'Unlocked') : `${reward.points} pts`}
                                </span>
                              </div>
                              <p className="text-[9.5px] text-gray-400 leading-snug">
                                {isRTL ? reward.descAr : reward.descEn}
                              </p>
                            </div>

                            <button
                              disabled={!isUnlocked || !walletCreditEnabled}
                              onClick={() => handleClaimVoucher(reward)}
                              className={`text-[9px] font-black px-3 py-1.5 rounded-lg transition-all ${
                                isUnlocked 
                                  ? 'bg-secondary text-white hover:scale-103' 
                                  : 'bg-gray-100 text-gray-400 border border-gray-200/50'
                              }`}
                            >
                              {isRTL ? 'استلام المكافأة' : 'Claim Reward'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Points Ledger / Dynamic Transaction History */}
                  <div className="bg-white rounded-2xl shadow-xs border border-gray-100 p-4 space-y-3">
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1">
                      <History className="w-4 h-4 text-primary" />
                      <span>{isRTL ? 'سجل نقاط الولاء' : 'Loyalty Points Ledger'}</span>
                    </h3>

                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                      {getLoyaltyLedger().map((item: any, i: number) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-slate-50 rounded-xl text-[10px]">
                          <div>
                            <span className="font-extrabold text-gray-800 block leading-tight">
                              {isRTL ? item.titleAr : item.titleEn}
                            </span>
                            <span className="text-[8px] text-gray-400 mt-0.5 block leading-none">
                              {item.date}
                            </span>
                          </div>
                          <span className={`font-black font-mono text-[10.5px] ${
                            item.points > 0 ? 'text-green-600' : 'text-secondary'
                          }`}>
                            {item.points > 0 ? `+${item.points}` : item.points} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
    </>
  );
};
