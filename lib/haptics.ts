import * as Haptics from 'expo-haptics';

// Small buzzes so taps feel native. They never throw: some phones have no motor.
export const tap = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
export const pick = () => { Haptics.selectionAsync().catch(() => {}); };
export const done = (ok = true) => {
  Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
};
