import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useGetMe, useGetChannel, useRequestPlayToken, useListChannels } from "@workspace/api-client-react";
import Hls from "hls.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  Tv,
  Play,
  Signal,
} from "lucide-react";

// ── Live timer ────────────────────────────────────────────────────────────────
function useLiveTimer(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Stream health dot ─────────────────────────────────────────────────────────
type Health = "connecting" | "live" | "buffering" | "error";
function HealthDot({ health }: { health: Health }) {
  const cfg: Record<Health, { color: string; label: string }> = {
    connecting: { color: "bg-yellow-400 animate-pulse", label: "Connecting…" },
    live:       { color: "bg-red-500 animate-pulse",    label: "LIVE" },
    buffering:  { color: "bg-orange-400 animate-pulse", label: "Buffering…" },
    error:      { color: "bg-gray-500",                 label: "Offline" },
  };
  const { color, label } = cfg[health];
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/60 text-white text-xs font-bold uppercase tracking-wider">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ── Main player ───────────────────────────────────────────────────────────────
export default function Player() {
  const params = useParams();
  const id = params.id;
  const [, setLocation] = useLocation();

  const videoRef  = useRef<HTMLVideoElement>(null);
  const hlsRef    = useRef<Hls | null>(null);
  const retryRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: me,      isLoading: isLoadingMe      } = useGetMe();
  const { data: channel, isLoading: isLoadingChannel, error: channelError } = useGetChannel(id ?? "");
  const { data: allChannels } = useListChannels();
  const requestPlayToken = useRequestPlayToken();

  const [health,    setHealth]    = useState<Health>("connecting");
  const [error,     setError]     = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [qualities, setQualities] = useState<{ label: string; index: number }[]>([]);
  const [currentQ,  setCurrentQ]  = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  const liveTime = useLiveTimer(isPlaying && health === "live");

  const isBlocked = !me || me.banned || me.access === "expired" || me.access === "banned";

  useEffect(() => {
    if (!isLoadingMe && isBlocked) setLocation("/watch");
  }, [isLoadingMe, isBlocked, setLocation]);

  const initPlayer = useCallback(async () => {
    if (isLoadingMe || isLoadingChannel || isBlocked || !id || !videoRef.current) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (retryRef.current) clearTimeout(retryRef.current);

    setError(null);
    setHealth("connecting");

    try {
      const ticket = await requestPlayToken.mutateAsync({ id });
      const video  = videoRef.current;
      if (!video) return;

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,

          // ── Stability: disable low-latency mode for regular HLS streams
          // lowLatencyMode causes constant live-edge seeking → flickering
          lowLatencyMode: false,

          // ── Buffer tuning: bigger buffer = smoother playback
          maxBufferLength: 60,           // up to 60s forward buffer
          maxMaxBufferLength: 120,       // absolute max
          backBufferLength: 30,          // keep 30s behind for seek
          maxBufferHole: 0.5,            // fill gaps up to 0.5s automatically

          // ── Live sync: stay 3 segments behind live edge (not 1)
          // Too close to edge = constant stalling and seeking
          liveSyncDurationCount: 5,
          liveMaxLatencyDurationCount: 15,
          liveBackBufferLength: 30,

          // ── Retry on network issues
          manifestLoadingMaxRetry: 8,
          levelLoadingMaxRetry: 8,
          fragLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 1000,
          levelLoadingRetryDelay: 1000,
          fragLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 8000,

          // ── Smooth ABR switching (no quality flicker mid-stream)
          abrEwmaDefaultEstimate: 1000000, // start assuming 1Mbps
          startLevel: -1,                  // auto-pick starting quality
        });
        hlsRef.current = hls;

        hls.loadSource(ticket.playlistUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          const qs = data.levels.map((l, i) => ({
            label: l.height ? `${l.height}p` : `Level ${i + 1}`,
            index: i,
          }));
          setQualities(qs);
          setCurrentQ(-1);
          setHealth("live");
          video.play().catch(() => {});
        });

        // Only mark live when we actually start playing — not on every fragment
        hls.on(Hls.Events.FRAG_PLAYING, () => setHealth("live"));

        // Debounce buffering state so brief stalls don't flicker the UI
        let bufferTimer: ReturnType<typeof setTimeout> | null = null;
        hls.on(Hls.Events.BUFFER_STALLED_ERROR, () => {
          if (bufferTimer) clearTimeout(bufferTimer);
          bufferTimer = setTimeout(() => setHealth("buffering"), 800);
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null; }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setHealth("buffering");
            hls.startLoad();
            retryRef.current = setTimeout(() => {
              setRetryCount((c) => c + 1);
            }, 5000);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            hls.destroy();
            setHealth("error");
            setError("Stream unavailable. Tap retry to reconnect.");
          }
        });

      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = ticket.playlistUrl;
        video.addEventListener("loadedmetadata", () => {
          setHealth("live");
          video.play().catch(() => {});
        });
      } else {
        setHealth("error");
        setError("Your browser does not support HLS playback.");
      }
    } catch {
      setHealth("error");
      setError("Failed to load the stream. It may be offline.");
    }
  }, [id, isLoadingMe, isLoadingChannel, isBlocked, retryCount]);

  useEffect(() => {
    initPlayer();
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [initPlayer]);

  const switchQuality = (index: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = index;
    setCurrentQ(index);
  };

  const otherChannels = allChannels?.filter((c) => c.id !== id).slice(0, 20) ?? [];

  if (isLoadingMe || isLoadingChannel) {
    return (
      <div className="container py-8 max-w-7xl space-y-6">
        <Skeleton className="w-32 h-10" />
        <div className="flex gap-6">
          <Skeleton className="flex-1 aspect-video rounded-xl bg-black" />
          <Skeleton className="w-64 h-[400px] rounded-xl hidden lg:block" />
        </div>
      </div>
    );
  }

  if (channelError || !channel) {
    return (
      <div className="container py-20 max-w-lg text-center space-y-6">
        <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
        <h2 className="text-2xl font-bold">Channel Not Found</h2>
        <p className="text-muted-foreground">This channel does not exist or was removed.</p>
        <Button onClick={() => setLocation("/watch")}>Return to Channels</Button>
      </div>
    );
  }

  return (
    <div className="container py-6 max-w-6xl space-y-4">
      <Link href="/watch">
        <Button variant="ghost" className="gap-2 -ml-4 hover:bg-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Channels
        </Button>
      </Link>

      <div className="flex gap-6 items-start">
        {/* Player + info */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-black rounded-xl overflow-hidden shadow-2xl border border-border relative group" style={{ maxHeight: "min(56.25vw, 520px)", aspectRatio: "16/9" }}>
            {/* Health + timer badges */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <HealthDot health={health} />
              {health === "live" && isPlaying && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/60 text-white text-xs font-mono">
                  <Clock className="h-3 w-3" />
                  {liveTime}
                </span>
              )}
            </div>

            {/* Quality buttons */}
            {qualities.length > 1 && (
              <div className="absolute top-3 right-3 z-10 flex gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => switchQuality(-1)}
                  className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${currentQ === -1 ? "bg-primary text-primary-foreground" : "bg-black/60 text-white hover:bg-black/80"}`}
                >
                  AUTO
                </button>
                {qualities.map((q) => (
                  <button
                    key={q.index}
                    onClick={() => switchQuality(q.index)}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${currentQ === q.index ? "bg-primary text-primary-foreground" : "bg-black/60 text-white hover:bg-black/80"}`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}

            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-black/80">
                <WifiOff className="h-12 w-12 text-destructive" />
                <p className="font-medium text-white">{error}</p>
                <Button onClick={() => setRetryCount((c) => c + 1)} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Retry
                </Button>
              </div>
            ) : (
              <>
                {health === "connecting" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3 pointer-events-none">
                    <Signal className="h-10 w-10 text-primary animate-pulse" />
                    <p className="text-white text-sm">Connecting to stream…</p>
                  </div>
                )}
                <video
                  ref={videoRef}
                  className="w-full h-full outline-none"
                  controls
                  autoPlay
                  playsInline
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  crossOrigin="anonymous"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onWaiting={() => setHealth("buffering")}
                  onPlaying={() => setHealth("live")}
                />
              </>
            )}
          </div>

          {/* Channel info card */}
          <div className="bg-card border border-border p-4 sm:p-6 rounded-xl flex flex-col sm:flex-row items-start gap-4">
            <div className="h-16 w-16 sm:h-20 sm:w-20 bg-black/20 rounded-lg flex items-center justify-center shrink-0 border border-border/50 p-2 overflow-hidden">
              {channel.logoUrl ? (
                <img src={channel.logoUrl} alt={channel.name} className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-muted-foreground font-bold">TV</span>
              )}
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{channel.name}</h1>
                {channel.isLive && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xs font-bold uppercase tracking-wider border border-red-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    Live
                  </div>
                )}
              </div>
              {channel.categoryName && (
                <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {channel.categoryName}
                </span>
              )}
              {channel.description && (
                <p className="text-muted-foreground mt-2">{channel.description}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <Wifi className="h-3 w-3" />
                <span>Stream auto-reconnects if interrupted</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {otherChannels.length > 0 && (
          <div className="hidden lg:flex flex-col w-64 shrink-0 bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Tv className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">More Channels</h3>
            </div>
            <div className="overflow-y-auto max-h-[600px] divide-y divide-border/50">
              {otherChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setLocation(`/watch/${ch.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left group"
                >
                  <div className="h-10 w-10 bg-black/30 rounded-lg flex items-center justify-center shrink-0 border border-border/50 overflow-hidden">
                    {ch.logoUrl ? (
                      <img src={ch.logoUrl} alt={ch.name} className="max-w-full max-h-full object-contain p-1" />
                    ) : (
                      <Tv className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{ch.name}</p>
                    {ch.isLive && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  <Play className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
