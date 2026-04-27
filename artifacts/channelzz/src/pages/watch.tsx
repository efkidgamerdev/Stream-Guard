Here's the full `watch.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetMe, 
  useListChannels, 
  useListCategories, 
  useListAnnouncements,
  useGetSettings,
  useSubmitChannelRequest,
  useUnseenChannelRequests,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertTriangle, Clock, Calendar, Lock, Play, MessageSquare, Tv, PlusCircle, CheckCircle2, XCircle, Bell } from "lucide-react";
import { differenceInDays, parseISO, isAfter } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

export default function Watch() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: isLoadingMe } = useGetMe();
  const { data: channels, isLoading: isLoadingChannels } = useListChannels();
  const { data: categories, isLoading: isLoadingCategories } = useListCategories();
  const { data: announcements } = useListAnnouncements();
  const { data: settings } = useGetSettings();
  const { data: unseenRequests } = useUnseenChannelRequests();
  const submitRequest = useSubmitChannelRequest();

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqNotes, setReqNotes] = useState("");
  const [reqSuccess, setReqSuccess] = useState(false);

  useEffect(() => {
    if (unseenRequests && unseenRequests.length > 0) {
      setNotifOpen(true);
    }
  }, [unseenRequests]);

  const handleSubmitRequest = async () => {
    if (!reqName.trim()) return;
    try {
      await submitRequest.mutateAsync({ channelName: reqName, notes: reqNotes });
      setReqSuccess(true);
      setReqName(""); setReqNotes("");
    } catch {}
  };

  const isBanned = me?.banned;
  const accessStatus = me?.access;

  const filteredChannels = channels?.filter(c => 
    activeCategory === "all" ? true : c.categoryId === activeCategory
  ) || [];

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

      {/* Notification Popup */}
      <AnimatePresence>
        {notifOpen && unseenRequests && unseenRequests.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-50 max-w-sm w-full"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                <h4 className="font-bold text-foreground">Channel Request Update</h4>
                <button onClick={() => setNotifOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
              </div>
              {unseenRequests.map((r) => (
                <div key={r.id} className={`flex items-start gap-3 p-3 rounded-xl border ${r.status === "approved" ? "bg-green-500/10 border-green-500/20" : "bg-destructive/10 border-destructive/20"}`}>
                  {r.status === "approved"
                    ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    : <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
                  <div>
                    <p className="text-sm font-semibold">"{r.channelName}" — {r.status === "approved" ? "Approved! 🎉" : "Not added"}</p>
                    {r.adminNote && <p className="text-xs text-muted-foreground mt-0.5">{r.adminNote}</p>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Channel Request Dialog */}
      <Dialog open={requestOpen} onOpenChange={(o) => { setRequestOpen(o); if (!o) setReqSuccess(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request a Channel</DialogTitle>
            <DialogDescription>
              Tell us what channel you'd like added and we'll look into it.
            </DialogDescription>
          </DialogHeader>
          {reqSuccess ? (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-semibold text-lg">Request Sent!</p>
              <p className="text-muted-foreground text-sm">We'll notify you here when it's reviewed.</p>
              <Button onClick={() => { setRequestOpen(false); setReqSuccess(false); }}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Channel Name *</label>
                <Input
                  placeholder="e.g. CNN International"
                  value={reqName}
                  onChange={(e) => setReqName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  placeholder="Any extra details about the channel..."
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setRequestOpen(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleSubmitRequest} disabled={!reqName.trim() || submitRequest.isPending}>
                  {submitRequest.isPending ? "Sending…" : "Send Request"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Categories + Request button */}
      <div className="flex items-center gap-3">
        <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar flex-1">
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
        {!isBlocked && me && (
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => setRequestOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Request Channel</span>
          </Button>
        )}
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
```
