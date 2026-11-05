import { Platform } from "react-native";

const directSignInEnabled =
  process.env.EXPO_PUBLIC_GOOGLE_DIRECT_SIGNIN_ENABLED === "true";
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

let configured = false;

export function isDirectGoogleSignInConfigured() {
  if (!directSignInEnabled || Platform.OS === "web" || !webClientId) return false;
  if (Platform.OS === "android") return Boolean(androidClientId);
  return Platform.OS !== "ios" || Boolean(iosClientId && iosUrlScheme);
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!isDirectGoogleSignInConfigured()) {
    throw new Error("Google Sign-In is not configured for this platform");
  }

  const { GoogleSignin, isSuccessResponse } = await import(
    "@react-native-google-signin/google-signin"
  );
  if (!configured) {
    GoogleSignin.configure({
      webClientId,
      iosClientId: iosClientId || "",
      offlineAccess: false,
    });
    configured = true;
  }
  if (Platform.OS === "android") {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  if (!response.data.idToken) {
    throw new Error("Google did not return an ID token. Check the OAuth client configuration.");
  }
  return response.data.idToken;
}
