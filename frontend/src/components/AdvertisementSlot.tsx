import { createElement, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { api, BACKEND_URL } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { Badge, Btn, Card, T } from "@/src/components/ui";
import { colors, radius, spacing, type } from "@/src/theme";

export type Advertisement = {
  id: string;
  title: string;
  description: string;
  media_type: "image" | "video" | "link";
  media_url?: string | null;
  alt_text?: string;
  destination_url?: string | null;
  display_duration_seconds: number;
  impression_token?: string;
};

function resolveMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || !BACKEND_URL) return url;
  return `${BACKEND_URL.replace(/\/$/, "")}${url}`;
}

function AdvertisementMedia({
  advertisement,
  onMediaError,
  autoPlay = false,
}: {
  advertisement: Advertisement;
  onMediaError?: (message: string) => void;
  autoPlay?: boolean;
}) {
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);

  useEffect(() => {
    if (!autoPlay || advertisement.media_type !== "video" || !videoLoading || videoError) return;
    const timeout = setTimeout(() => {
      setVideoError("Advertisement video is taking too long to load.");
    }, 20000);
    return () => clearTimeout(timeout);
  }, [advertisement.media_type, autoPlay, playbackAttempt, videoError, videoLoading]);

  if (!advertisement.media_url) return null;
  const mediaUrl = resolveMediaUrl(advertisement.media_url);
  if (advertisement.media_type === "image") {
    return (
      <Image
        source={{ uri: mediaUrl }}
        style={{ width: "100%", height: 180, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }}
        contentFit="cover"
        accessibilityLabel={advertisement.alt_text || advertisement.title}
        onError={() => onMediaError?.("Advertisement image could not be loaded.")}
      />
    );
  }

  if (advertisement.media_type !== "video") return null;
  const safeUrl = mediaUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const playerWidth = autoPlay ? "78%" : "100%";
  const playerStyle = {
    width: playerWidth as `${number}%`,
    maxWidth: autoPlay ? 480 : undefined,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: "hidden" as const,
    backgroundColor: "#000",
    alignSelf: "center" as const,
  };
  const retryPlayback = () => {
    setVideoLoading(true);
    setVideoError(null);
    setPlaybackAttempt((attempt) => attempt + 1);
  };
  const showVideoError = (message: string) => {
    setVideoLoading(false);
    setVideoError(message);
  };

  if (Platform.OS === "web") {
    return (
      <View style={[playerStyle, { position: "relative" }]}>
        {createElement("video", {
          key: playbackAttempt,
          src: mediaUrl,
          controls: true,
          autoPlay,
          muted: true,
          playsInline: true,
          preload: "auto",
          "aria-label": advertisement.alt_text || advertisement.title,
          onLoadStart: () => setVideoLoading(true),
          onCanPlay: () => {
            setVideoLoading(false);
            setVideoError(null);
          },
          onError: () => showVideoError("Advertisement video could not be loaded or played."),
          style: { width: "100%", height: "100%", display: "block", backgroundColor: "#000" },
        })}
        {videoLoading && !videoError ? (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Loading advertisement video"
            style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" }}
          >
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
        {videoError ? (
          <VideoPlaybackFallback message={videoError} onRetry={retryPlayback} />
        ) : null}
      </View>
    );
  }
  return (
    <View style={[playerStyle, { position: "relative" }]}>
      <WebView
        key={playbackAttempt}
        source={{
          html: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}video{display:block}</style><video src="${safeUrl}" controls ${autoPlay ? "autoplay" : ""} muted playsinline preload="auto" aria-label="${(advertisement.alt_text || advertisement.title).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}" style="width:100%;height:100%;background:#000" oncanplay="window.ReactNativeWebView?.postMessage('video-ready')" onerror="window.ReactNativeWebView?.postMessage('video-error')"></video>`,
        }}
        style={{ flex: 1, backgroundColor: "#000" }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={!autoPlay}
        allowsFullscreenVideo
        scrollEnabled={false}
        originWhitelist={["*"]}
        accessibilityLabel={advertisement.alt_text || advertisement.title}
        onMessage={(event) => {
          if (event.nativeEvent.data === "video-ready") {
            setVideoLoading(false);
            setVideoError(null);
          } else if (event.nativeEvent.data === "video-error") {
            showVideoError("Advertisement video could not be loaded or played.");
          }
        }}
        onLoadStart={() => setVideoLoading(true)}
        onError={() => showVideoError("Advertisement video could not be loaded. Check your connection and try again.")}
        onHttpError={(event) => showVideoError(`Advertisement video server returned HTTP ${event.nativeEvent.statusCode}.`)}
      />
      {videoLoading && !videoError ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading advertisement video"
          style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" }}
        >
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}
      {videoError ? <VideoPlaybackFallback message={videoError} onRetry={retryPlayback} /> : null}
    </View>
  );
}

export { AdvertisementMedia };

function VideoPlaybackFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View
      style={{
        position: "absolute",
        inset: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.xs,
        padding: spacing.md,
        backgroundColor: colors.surfaceInverse,
      }}
    >
      <Ionicons name="videocam-off-outline" size={24} color={colors.onSurfaceInverse} />
      <T size={type.sm} color={colors.onSurfaceInverse} style={{ textAlign: "center" }}>{message}</T>
      <Btn title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function AdvertisementSlot() {
  const toast = useToast();
  const { show: showToast } = toast;
  const [advertisement, setAdvertisement] = useState<Advertisement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.get<{ advertisement: Advertisement | null }>("/advertisements/current")
      .then(async (result) => {
        if (!mounted || !result.advertisement) {
          if (mounted) setAdvertisement(null);
          return;
        }
        const reservedAd = result.advertisement;
        if (!reservedAd.impression_token) {
          throw new Error("Could not verify the advertisement display reservation.");
        }
        const impression = await api.post<{ displayed: boolean }>(
          `/advertisements/${reservedAd.id}/impression`,
          { reservation_token: reservedAd.impression_token },
        );
        if (mounted && impression.displayed) setAdvertisement(reservedAd);
        else if (mounted) setAdvertisement(null);
      })
      .catch((error: unknown) => {
        if (mounted) {
          setAdvertisement(null);
          showToast(error instanceof Error ? error.message : "Could not load advertisement", "error");
        }
      });
    return () => { mounted = false; };
  }, [showToast]);

  useEffect(() => {
    if (!advertisement || dismissed) return;
    const timer = setTimeout(() => setDismissed(true), advertisement.display_duration_seconds * 1000);
    return () => clearTimeout(timer);
  }, [advertisement, dismissed]);

  if (!advertisement || dismissed) return null;

  const openPromotion = async () => {
    try {
      const { destination_url: destinationUrl } = await api.post<{ destination_url: string }>(
        `/advertisements/${advertisement.id}/click`,
        { event: "click" },
      );
      await Linking.openURL(destinationUrl);
    } catch (error: any) {
      toast.show(error?.message || "Could not open this promotion", "error");
    }
  };

  return (
    <Card style={{ gap: spacing.sm, alignItems: "center", borderColor: colors.brandSecondary, backgroundColor: colors.surface }}>
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Badge label="Sponsored" tone="info" />
          <T weight="bold" size={type.lg} style={{ flexShrink: 1 }}>{advertisement.title}</T>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss advertisement"
          onPress={() => setDismissed(true)}
          hitSlop={10}
          style={{ padding: spacing.xs }}
        >
          <Ionicons name="close" size={20} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>
      {advertisement.description ? (
        <T size={type.sm} color={colors.onSurfaceSecondary} style={{ alignSelf: "stretch" }}>{advertisement.description}</T>
      ) : null}
      {advertisement.media_type === "video" ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs }}>
          <View style={{ width: 26, height: 26, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand }}>
            <T weight="extrabold" size={type.sm} color={colors.onBrandPrimary}>H</T>
          </View>
          <T weight="bold" size={type.sm} color={colors.brand}>Hostel360</T>
        </View>
      ) : null}
      {advertisement.media_url ? (
        advertisement.destination_url && advertisement.media_type === "image" ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open promotion: ${advertisement.alt_text || advertisement.title}`}
            onPress={openPromotion}
          >
            <AdvertisementMedia key={advertisement.media_url} advertisement={advertisement} onMediaError={(message) => toast.show(message, "error")} />
          </Pressable>
        ) : (
          <View style={{ width: "100%", alignItems: "center" }}>
            <AdvertisementMedia
              key={advertisement.media_url}
              advertisement={advertisement}
              autoPlay={advertisement.media_type === "video"}
              onMediaError={(message) => toast.show(message, "error")}
            />
          </View>
        )
      ) : null}
      {advertisement.destination_url ? (
        <Pressable
          accessibilityRole="link"
          onPress={openPromotion}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start" }}
        >
          <T weight="semibold" color={colors.brand}>Learn more</T>
          <Ionicons name="open-outline" size={16} color={colors.brand} />
        </Pressable>
      ) : null}
    </Card>
  );
}
