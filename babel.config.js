module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 ships its worklets transform in react-native-worklets. This
    // plugin MUST be listed last. Moti + Reanimated animations depend on it at
    // runtime (a missing/failed transform breaks animations without a build error).
    plugins: ['react-native-worklets/plugin'],
  };
};
