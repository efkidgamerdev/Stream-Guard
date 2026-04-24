import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetMe, 
  useListChannels, 
  useListCategories, 
  useListAnnouncements,
  useGetSettings
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, Calendar, Lock, Play, MessageSquare, Tv } from "lucide-react";
import { differenceInDays, parseISO, isAfter } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

export default function Watch() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: isLoadingMe } = useGetMe();
  const { data: channels, isLoading: isLoadingChannels } = useListChannels();
  const { data: categories, isLoading: isLoadingCategories } = useListCategories();
  const { data: announcements } = useListAnnouncements();
  const { data: settings } = useGetSettings();

  const [activeCategory, setActiveCategory] = useState<string>("all");

  const isBanned = me?.banned;
  const accessStatus = me?.access;

  // Filter channels
  const filteredChannels = channels?.filter(c => 
    activeCategory === "all" ? true : c.categoryId === activeCategory
  ) || [];

  // Determine remaining days for trial or paid
  const getRemainingText = () => {
    if (!me) return null;
    const now = new Date();
    if (me.access === "trial" && me.trialEndsAt) {
      const ends = parseISO(me.trialEndsAt);
      if (isAfter(ends, now)) {
        return `Trial expires in ${differenceInDays(ends, now)} days`;
      }
      return "Trial expired";
    }
    if (me.access === "paid" && me.subscriptionEndsAt) {
      const ends = parseISO(me.subscriptionEndsAt);
      if (isAfter(ends, now)) {
        return `Subscription active (${differenceInDays(ends, now)} days left)`;
      }
      return "Subscription expired";
    }
    return null;
  };

  const remainingText = getRemainingText();
  const isBlocked = accessStatus === "expired" || accessStatus === "banned" || isBanned;

  if (isLoadingMe || isLoadingCategories || isLoadingChannels) {
    return (
      <div className="container py-8 space-y-8">
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Announcements */}
      {announcements && announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div key={ann.id} className="bg-primary/10 border border-primary/20 text-primary-foreground p-4 rounded-xl flex items-start gap-3">
              <MessageSquare className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-foreground">{ann.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{ann.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Access Status Banner */}
      {isBlocked ? (
        <div className="bg-destructive/10 border border-destructive/20 p-6 rounded-2xl flex flex-col items-center text-center space-y-4">
          <Lock className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              {isBanned ? "Account Suspended" : "Subscription Expired"}
            </h2>
            <p className="text-muted-foreground mt-2 max-w-lg mx-auto">
              {isBanned 
                ? "Your account has been suspended due to policy violations." 
                : "Your access has expired. Please renew your subscription to continue watching."}
            </p>
          </div>
          {!isBanned && settings?.pricingText && (
            <div className="bg-background/50 p-4 rounded-xl max-w-md w-full border border-border text-left">
              <p className="text-sm font-medium">{settings.pricingText}</p>
            </div>
          )}
          {!isBanned && settings?.whatsappNumber && (
            <Button 
              size="lg" 
              className="rounded-full bg-green-600 hover:bg-green-700 text-white"
              onClick={() => window.open(`https://wa.me/${settings.whatsappNumber}?text=Hi,%20I%20want%20to%20upgrade%20my%20Channelzz%20account.`, "_blank")}
            >
              Contact via WhatsApp to Renew
            </Button>
          )}
        </div>
      ) : remainingText && (
        <div className="bg-secondary border border-border p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            {accessStatus === "trial" ? <Clock className="text-yellow-500 h-5 w-5" /> : <Calendar className="text-primary h-5 w-5" />}
            <span className="font-medium text-foreground">{remainingText}</span>
          </div>
          {accessStatus === "trial" && settings?.whatsappNumber && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => window.open(`https://wa.me/${settings.whatsappNumber}?text=Hi,%20I%20want%20to%20upgrade%20my%20Channelzz%20account.`, "_blank")}
            >
              Upgrade Now
            </Button>
          )}
        </div>
      )}

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
        <Button 
          variant={activeCategory === "all" ? "default" : "secondary"}
          className="rounded-full shrink-0"
          onClick={() => setActiveCategory("all")}
          disabled={isBlocked}
        >
          All Channels
        </Button>
        {categories?.map((cat) => (
          <Button 
            key={cat.id}
            variant={activeCategory === cat.id ? "default" : "secondary"}
            className="rounded-full shrink-0"
            onClick={() => setActiveCategory(cat.id)}
            disabled={isBlocked}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      {/* Channels Grid */}
      <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 ${isBlocked ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
        <AnimatePresence mode="popLayout">
          {filteredChannels.map((channel) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              key={channel.id}
              className="group relative bg-card border border-border/50 rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-[0_0_20px_rgba(var(--primary),0.2)] transition-all cursor-pointer aspect-[16/10] flex flex-col"
              onClick={() => {
                if (!isBlocked) {
                  setLocation(`/watch/${channel.id}`);
                }
              }}
            >
              <div className="flex-1 bg-black/40 flex items-center justify-center p-4 relative">
                {channel.logoUrl ? (
                  <img src={channel.logoUrl} alt={channel.name} className="max-w-full max-h-full object-contain drop-shadow-lg" />
                ) : (
                  <Tv className="h-10 w-10 text-muted-foreground/50" />
                )}
                
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-primary text-primary-foreground p-3 rounded-full translate-y-4 group-hover:translate-y-0 transition-transform">
                    <Play className="h-6 w-6 fill-current" />
                  </div>
                </div>
              </div>
              <div className="p-3 bg-card border-t border-border/50">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm truncate">{channel.name}</h3>
                  {channel.isLive && (
                    <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {filteredChannels.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
            No channels found in this category.
          </div>
        )}
      </div>
    </div>
  );
}
