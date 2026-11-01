import { useEffect, useState } from "react";
import { api, API_ORIGIN } from "./api";
import { AlertMessage, Button, Card } from "./ui";

type Advertisement = {
  id: string;
  title: string;
  description?: string;
  media_type: "image" | "video" | "link";
  media_url?: string | null;
  alt_text?: string;
  destination_url?: string | null;
  display_duration_seconds: number;
  impression_token?: string;
};

function mediaUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith("/") ? value : `/${value}`}`;
}

export function AdvertisementSlot() {
  const [advertisement, setAdvertisement] = useState<Advertisement | null>(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<{ advertisement: Advertisement | null }>("/advertisements/current")
      .then(async (result) => {
        const reserved = result.advertisement;
        if (!reserved) return;
        if (!reserved.impression_token) throw new Error("Could not verify the advertisement display reservation.");
        const impression = await api.post<{ displayed: boolean }>(
          `/advertisements/${encodeURIComponent(reserved.id)}/impression`,
          { reservation_token: reserved.impression_token },
        );
        if (active && impression.displayed) setAdvertisement(reserved);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load advertisement.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!advertisement || dismissed) return;
    const timer = window.setTimeout(() => setDismissed(true), advertisement.display_duration_seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [advertisement, dismissed]);

  if (dismissed || (!advertisement && !error)) return null;
  if (!advertisement) return <AlertMessage tone="error">{error}</AlertMessage>;

  const openPromotion = async () => {
    const popup = advertisement.destination_url ? window.open("about:blank", "_blank") : null;
    try {
      const result = await api.post<{ destination_url: string }>(
        `/advertisements/${encodeURIComponent(advertisement.id)}/click`,
        { event: "click" },
      );
      const parsed = new URL(result.destination_url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("The promotion returned an unsafe destination URL.");
      }
      if (popup) {
        popup.opener = null;
        popup.location.assign(parsed.href);
      } else if (advertisement.destination_url) {
        window.location.assign(parsed.href);
      }
    } catch (reason) {
      popup?.close();
      setError(reason instanceof Error ? reason.message : "Could not open this promotion.");
    }
  };
  const url = advertisement.media_url ? mediaUrl(advertisement.media_url) : "";

  return <Card className="stack ad-card">
    <div className="spread"><div className="row"><span className="badge">Sponsored</span><b>{advertisement.title}</b></div><Button kind="ghost" onClick={() => setDismissed(true)} aria-label="Dismiss advertisement">×</Button></div>
    {advertisement.description && <p className="muted">{advertisement.description}</p>}
    {advertisement.media_type === "image" && url && (
      advertisement.destination_url
        ? <button className="ad-media-button" onClick={() => void openPromotion()} aria-label={`Open promotion: ${advertisement.alt_text || advertisement.title}`}><img className="ad-image" src={url} alt={advertisement.alt_text || advertisement.title} onError={() => setError("Advertisement image could not be loaded.")} /></button>
        : <img className="ad-image" src={url} alt={advertisement.alt_text || advertisement.title} onError={() => setError("Advertisement image could not be loaded.")} />
    )}
    {advertisement.media_type === "video" && url && <video className="ad-video" src={url} controls autoPlay muted playsInline preload="auto" aria-label={advertisement.alt_text || advertisement.title} onError={() => setError("Advertisement video could not be loaded or played.")} />}
    {advertisement.destination_url && <Button kind="secondary" onClick={() => void openPromotion()}>Learn more</Button>}
    {error && <AlertMessage tone="error">{error}</AlertMessage>}
  </Card>;
}
