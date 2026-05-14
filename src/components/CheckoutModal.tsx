import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  propertyTitle: string;
  totalPrice: number;
  currency: string;
  numNights: number;
  checkIn: string;
  checkOut: string;
}

// Load Paystack inline script
function loadPaystackScript(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).PaystackPop) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = () => resolve();
    document.body.appendChild(script);
  });
}

const FALLBACK_RATE = 134.29;

export function CheckoutModal({
  open,
  onOpenChange,
  bookingId,
  propertyTitle,
  totalPrice,
  currency,
  numNights,
  checkIn,
  checkOut,
}: CheckoutModalProps) {
  const navigate = useNavigate();
  const [selectedCurrency, setSelectedCurrency] = useState<'KES' | 'USD'>('KES');
  const [selectedMethod, setSelectedMethod] = useState<'mpesa' | 'airtel' | 'card' | 'bank' | null>('mpesa');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [exchangeRate, setExchangeRate] = useState(FALLBACK_RATE);
  const [isProcessing, setIsProcessing] = useState(false);

  const usdAmount = totalPrice;
  const kesAmount = Math.round(totalPrice * exchangeRate);
  const displayAmount = selectedCurrency === 'KES'
    ? `KES ${kesAmount.toLocaleString()}`
    : `$${usdAmount.toFixed(2)}`;

  // Fetch live exchange rate
  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/USD')
      .then(r => r.json())
      .then(data => { if (data?.rates?.KES) setExchangeRate(data.rates.KES); })
      .catch(() => {});
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedMethod('mpesa');
      setPhoneNumber('');
      setSelectedCurrency('KES');
    }
  }, [open]);

  // Toggle method — clicking same method deselects it
  const toggleMethod = (method: 'mpesa' | 'airtel' | 'card' | 'bank') => {
    setSelectedMethod(prev => prev === method ? null : method);
    setPhoneNumber('');
  };

  const handlePay = async () => {
    if (!selectedMethod) {
      toast.error('Please select a payment method');
      return;
    }
    if ((selectedMethod === 'mpesa' || selectedMethod === 'airtel') && !phoneNumber.trim()) {
      toast.error(`Please enter your ${selectedMethod === 'mpesa' ? 'M-Pesa' : 'Airtel Money'} number`);
      return;
    }

    setIsProcessing(true);
    try {
      // Load Paystack inline script
      await loadPaystackScript();

      const finalAmount = selectedCurrency === 'KES' ? kesAmount : usdAmount;
      const fullPhone = phoneNumber ? '+254' + phoneNumber.replace(/^0+/, '').replace(/\s/g, '') : undefined;

      // Get access code from edge function
      const { data: checkoutData, error } = await supabase.functions.invoke('create-booking-checkout', {
        body: {
          bookingId,
          propertyTitle,
          totalPrice: finalAmount,
          currency: selectedCurrency,
          numNights,
          checkIn,
          checkOut,
          paymentMethod: selectedMethod,
          phoneNumber: fullPhone,
        },
      });

      if (error || !checkoutData?.accessCode) {
        throw new Error(checkoutData?.error || 'Failed to initiate payment');
      }

      const { accessCode, reference } = checkoutData;

      // Close our modal
      onOpenChange(false);

      // Map method to Paystack channel
      const channelMap: Record<string, string[]> = {
        mpesa: ['mobile_money'],
        airtel: ['mobile_money'],
        card: ['card'],
        bank: ['bank_transfer'],
      };

      // Open Paystack inline popup
      const PaystackPop = (window as any).PaystackPop;
      const handler = PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        access_code: accessCode,
        channels: channelMap[selectedMethod] || ['card', 'mobile_money', 'bank_transfer'],
        ...(fullPhone && { phone: fullPhone }),
        onSuccess: () => {
          navigate(`/booking-confirmation/${bookingId}?payment=success&reference=${reference}`);
        },
        onCancel: () => {
          toast.error('Payment cancelled. You can retry from your bookings page.');
          navigate(`/booking-confirmation/${bookingId}`);
        },
      });

      handler.openIframe();

    } catch (err: any) {
      toast.error(err.message || 'Payment could not be initiated. Please try again.');
      setIsProcessing(false);
    }
  };

  const methodConfig = {
    mpesa:  { label: 'M-Pesa', sub: 'STK push · Enter PIN on phone', color: '#22c55e', bg: '#f0fdf4', textColor: '#166534', icon: '📱', phonePlaceholder: '712 345 678' },
    airtel: { label: 'Airtel Money', sub: 'STK push · Enter PIN on phone', color: '#dc2626', bg: '#fef2f2', textColor: '#991b1b', icon: '📱', phonePlaceholder: '733 345 678' },
    card:   { label: 'Card', sub: 'Visa · Mastercard · Amex', color: '#1d4ed8', bg: '#eff6ff', textColor: '#1e40af', icon: '💳', phonePlaceholder: '' },
    bank:   { label: 'Bank transfer', sub: 'Direct from your bank account', color: '#7c3aed', bg: '#f5f3ff', textColor: '#5b21b6', icon: '🏦', phonePlaceholder: '' },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-[440px] overflow-hidden rounded-2xl">

        {/* Header */}
        <div style={{ background: '#0d1f3c', padding: '1.1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="32" height="32" viewBox="0 0 120 120" fill="none">
              <rect width="22" height="90" x="8" y="15" fill="#1a3a6b" rx="3"/>
              <rect width="22" height="90" x="90" y="15" fill="#1a3a6b" rx="3"/>
              <rect width="60" height="18" x="30" y="51" fill="#1a3a6b" rx="3"/>
              <polygon points="60,10 18,52 102,52" fill="#b8922a"/>
              <rect width="16" height="14" x="52" y="38" fill="#1a3a6b" rx="2"/>
            </svg>
            <div>
              <p style={{ color: '#fff', fontSize: '15px', fontWeight: 600, margin: 0, letterSpacing: '1px' }}>HOSTIVA</p>
              <p style={{ color: '#b8922a', fontSize: '9px', margin: 0, letterSpacing: '1.5px' }}>STAY. RELAX. BELONG.</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.08)', padding: '4px 10px', borderRadius: '20px' }}>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>🔒</span>
            <span style={{ color: '#a0aec0', fontSize: '11px' }}>Secure checkout</span>
          </div>
        </div>

        {/* Gold divider */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #b8922a, #e4b84a, #b8922a)' }} />

        <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>

          {/* Booking summary */}
          <div className="px-6 py-3 border-b bg-muted/30">
            <p className="text-xs text-muted-foreground mb-0.5 uppercase tracking-wider">Booking summary</p>
            <p className="text-sm font-medium mb-0.5">{propertyTitle}</p>
            <p className="text-xs text-muted-foreground">{numNights} night{numNights > 1 ? 's' : ''} · {checkIn} – {checkOut}</p>
          </div>

          {/* Currency switcher */}
          <div className="px-6 py-3 border-b">
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Choose currency</p>
            <div className="flex gap-2">
              {(['KES', 'USD'] as const).map(cur => (
                <button
                  key={cur}
                  onClick={() => setSelectedCurrency(cur)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    border: selectedCurrency === cur ? '2px solid #0d1f3c' : '1px solid var(--border)',
                    background: selectedCurrency === cur ? '#0d1f3c' : 'transparent',
                    color: selectedCurrency === cur ? '#fff' : 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {cur === 'KES' ? `🇰🇪 KES ${kesAmount.toLocaleString()}` : `🇺🇸 $${usdAmount.toFixed(2)}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              1 USD = {exchangeRate.toFixed(2)} KES · Live rate
            </p>
          </div>

          {/* Payment methods */}
          <div className="px-6 py-3 border-b">
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Payment method</p>
            <div className="flex flex-col gap-2">
              {(Object.keys(methodConfig) as Array<keyof typeof methodConfig>).map((method) => {
                const config = methodConfig[method];
                const isSelected = selectedMethod === method;
                return (
                  <div
                    key={method}
                    onClick={() => toggleMethod(method)}
                    style={{
                      border: isSelected ? `2px solid ${config.color}` : '0.5px solid var(--border)',
                      background: isSelected ? config.bg : 'transparent',
                      borderRadius: '10px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '34px', height: '34px', background: config.color, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                        {config.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '14px', fontWeight: 500, margin: 0, color: isSelected ? config.textColor : 'inherit' }}>{config.label}</p>
                        <p style={{ fontSize: '11px', margin: 0, color: isSelected ? config.color : 'var(--muted-foreground)' }}>{config.sub}</p>
                      </div>
                      <div style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        border: isSelected ? `2px solid ${config.color}` : '1.5px solid var(--border)',
                        background: isSelected ? config.color : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        transition: 'all 0.15s',
                      }}>
                        {isSelected && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>✓</span>}
                      </div>
                    </div>

                    {/* Phone input for M-Pesa / Airtel */}
                    {isSelected && (method === 'mpesa' || method === 'airtel') && (
                      <div style={{ marginTop: '10px', borderTop: `0.5px solid ${config.color}30`, paddingTop: '10px' }} onClick={e => e.stopPropagation()}>
                        <p style={{ fontSize: '12px', color: config.textColor, margin: '0 0 6px' }}>
                          {method === 'mpesa' ? 'Safaricom M-Pesa number' : 'Airtel Money number'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `0.5px solid ${config.color}80`, borderRadius: '8px', padding: '6px 10px', gap: '6px' }}>
                          <span style={{ fontSize: '13px', color: config.textColor, fontWeight: 500, borderRight: `0.5px solid ${config.color}40`, paddingRight: '8px', marginRight: '2px', whiteSpace: 'nowrap' }}>
                            🇰🇪 +254
                          </span>
                          <input
                            type="tel"
                            placeholder={config.phonePlaceholder}
                            value={phoneNumber}
                            onChange={e => setPhoneNumber(e.target.value.replace(/[^\d\s]/g, ''))}
                            style={{ border: 'none', background: 'transparent', fontSize: '13px', outline: 'none', flex: 1, color: '#111' }}
                          />
                        </div>
                        <p style={{ fontSize: '11px', color: config.color, margin: '5px 0 0' }}>
                          You will receive an STK push prompt. Enter your PIN to confirm payment.
                        </p>
                      </div>
                    )}

                    {/* Card note */}
                    {isSelected && method === 'card' && (
                      <div style={{ marginTop: '10px', borderTop: '0.5px solid #bfdbfe', paddingTop: '10px' }} onClick={e => e.stopPropagation()}>
                        <p style={{ fontSize: '12px', color: config.textColor, margin: 0 }}>
                          You will enter your card details securely on the next screen. Visa, Mastercard and Amex accepted.
                        </p>
                      </div>
                    )}

                    {/* Bank transfer note */}
                    {isSelected && method === 'bank' && (
                      <div style={{ marginTop: '10px', borderTop: '0.5px solid #ddd6fe', paddingTop: '10px' }} onClick={e => e.stopPropagation()}>
                        <p style={{ fontSize: '12px', color: config.textColor, margin: 0 }}>
                          Bank account details will be shown on the next screen. Transfer must be completed within 24 hours.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pay button */}
          <div className="px-6 py-4">
            <button
              onClick={handlePay}
              disabled={isProcessing || !selectedMethod}
              className="w-full py-3.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: '#0d1f3c', color: '#fff', border: 'none', cursor: isProcessing || !selectedMethod ? 'not-allowed' : 'pointer' }}
            >
              {isProcessing ? '⏳ Processing...' : `🔒 Pay ${displayAmount}`}
            </button>
            <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
              <span style={{ color: '#b8922a' }}>🛡</span>
              256-bit SSL encryption · Powered by Paystack
            </p>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}