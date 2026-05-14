import { MessageCircle } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const WHATSAPP_NUMBER = '+18722217881';

export function WhatsAppButton() {
  const location = useLocation();
  const params = useParams();
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);

  // Detect property detail pages and fetch the property title for richer context
  useEffect(() => {
    const match = location.pathname.match(/^\/property\/([0-9a-f-]{36})/i);
    if (!match) {
      setPropertyTitle(null);
      return;
    }
    const id = match[1];
    let cancelled = false;
    supabase
      .from('properties')
      .select('title')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPropertyTitle(data?.title ?? null);
      });
    return () => { cancelled = true; };
  }, [location.pathname]);

  const buildMessage = () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const path = location.pathname;
    let context = 'I have a question';

    if (propertyTitle) {
      context = `I'm interested in this property: "${propertyTitle}"`;
    } else if (path.startsWith('/search')) {
      context = "I'm browsing listings and need help";
    } else if (path.startsWith('/bookings')) {
      context = 'I have a question about my booking';
    } else if (path.startsWith('/host')) {
      context = "I'm a host and need assistance";
    } else if (path.startsWith('/become-host')) {
      context = "I'd like to learn more about hosting";
    } else if (path.startsWith('/info/')) {
      const topic = path.replace('/info/', '').replace(/-/g, ' ');
      context = `I have a question about ${topic}`;
    } else if (path === '/' || path === '') {
      context = "I'd like to learn more about Hostiva";
    }

    return `Hi Hostiva! ${context}.\n\nPage: ${url}`;
  };

  const href = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, '')}?text=${encodeURIComponent(buildMessage())}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Hostiva on WhatsApp"
      className="fixed bottom-5 left-5 z-50 group flex items-center gap-2 bg-[#25D366] hover:bg-[#20BA5A] text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 px-4 py-3 hover:scale-105"
    >
      <span className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
      </span>
      <MessageCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-sm font-semibold">Chat with us</span>
    </a>
  );
}
