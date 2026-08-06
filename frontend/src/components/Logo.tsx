import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "@/src/theme";
import { T } from "@/src/components/ui";

export function Logo({ size = 40, showText = true, light = false }: { size?: number; showText?: boolean; light?: boolean }) {
  const textColor = light ? colors.onBrandPrimary : colors.onSurface;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: colors.brand,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="business" size={size * 0.52} color={colors.onBrandPrimary} />
        <View
          style={{
            position: "absolute",
            bottom: size * 0.16,
            width: size * 0.4,
            height: 3,
            borderRadius: 3,
            backgroundColor: colors.warning,
          }}
        />
      </View>
      {showText ? (
        <View>
          <T weight="extrabold" size={size * 0.5} color={textColor}>
            Hostel{" "}
            <T weight="extrabold" size={size * 0.5} color={colors.warning}>
              360
            </T>
          </T>
        </View>
      ) : null}
    </View>
  );
}
