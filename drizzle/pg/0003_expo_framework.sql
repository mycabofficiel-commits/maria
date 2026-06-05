-- Add "expo" to the framework enum so Expo/React Native projects can be stored
ALTER TYPE "framework" ADD VALUE IF NOT EXISTS 'expo';
