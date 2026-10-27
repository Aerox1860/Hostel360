import { useEffect, useRef } from "react";

const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              theme: "outline";
              size: "large";
              text: "continue_with";
              shape: "rectangular";
              width: number;
            },
          ) => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  onCredential: (idToken: string) => void;
  onError: (error: Error) => void;
}

export function GoogleSignInButton({ onCredential, onError }: GoogleSignInButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError });

  useEffect(() => {
    callbacks.current = { onCredential, onError };
  }, [onCredential, onError]);

  useEffect(() => {
    const buttonElement = container.current;
    if (!GOOGLE_CLIENT_ID || !buttonElement) return;
    let active = true;
    let script: HTMLScriptElement | null = null;
    let onLoad: (() => void) | null = null;
    let onLoadError: (() => void) | null = null;

    const initialize = () => {
      const googleId = window.google?.accounts?.id;
      if (!active || !googleId) {
        if (active) callbacks.current.onError(new Error("Google Sign-In could not be initialized."));
        return;
      }
      try {
        googleId.initialize({
          client_id: GOOGLE_CLIENT_ID,
          auto_select: false,
          callback: (response) => {
            if (response.credential) callbacks.current.onCredential(response.credential);
            else callbacks.current.onError(new Error("Google did not return an ID token."));
          },
        });
        googleId.renderButton(buttonElement, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          width: Math.min(360, Math.max(240, buttonElement.clientWidth)),
        });
      } catch {
        callbacks.current.onError(new Error("Google Sign-In could not be initialized for this domain."));
      }
    };

    const failLoading = () => {
      if (active) callbacks.current.onError(new Error("Unable to load Google Sign-In. Check your connection and try again."));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_SCRIPT_URL}"]`,
    );
    if (window.google?.accounts?.id) {
      initialize();
    } else if (existingScript) {
      if (existingScript.getAttribute("data-loaded") === "true") {
        failLoading();
      } else {
        onLoad = initialize;
        onLoadError = failLoading;
        existingScript.addEventListener("load", onLoad, { once: true });
        existingScript.addEventListener("error", onLoadError, { once: true });
      }
    } else {
      script = document.createElement("script");
      script.src = GOOGLE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      onLoad = () => {
        script?.setAttribute("data-loaded", "true");
        initialize();
      };
      onLoadError = failLoading;
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onLoadError, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      if (existingScript && onLoad) existingScript.removeEventListener("load", onLoad);
      if (existingScript && onLoadError) existingScript.removeEventListener("error", onLoadError);
      if (script && onLoad) script.removeEventListener("load", onLoad);
      if (script && onLoadError) script.removeEventListener("error", onLoadError);
      buttonElement.replaceChildren();
    };
  }, []);

  return (
    <div
      data-testid="login-google"
      ref={container}
      style={{ width: "100%", minHeight: 44, display: "flex", justifyContent: "center" }}
    />
  );
}
