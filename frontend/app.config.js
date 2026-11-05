module.exports = ({ config }) => {
  const plugins = [...(config.plugins || [])];
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

  plugins.push(
    iosUrlScheme
      ? [
          "@react-native-google-signin/google-signin",
          { iosUrlScheme },
        ]
      : "@react-native-google-signin/google-signin",
  );

  return {
    ...config,
    name: "Hostel360",
    plugins,
  };
};
