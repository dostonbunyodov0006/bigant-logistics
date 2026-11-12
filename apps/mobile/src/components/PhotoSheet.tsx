import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { usePhotoCapture } from '../hooks/usePhotoCapture';
import { PhotoRequiredBadge, Sheet } from './Sheet';
import { Icon } from './Icon';
import { colors } from './theme';

/**
 * The proof step for arriving at a pickup, handing over the cargo, and handing
 * a return back.
 *
 * The photo rule is stated up front and enforced by the button being off, not
 * by an alert after the tap — the driver should never press the thing that
 * finishes the job and be told no.
 */
export function PhotoSheet({
  visible,
  onClose,
  title,
  subtitle,
  confirmLabel,
  commentPlaceholder,
  pending,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  confirmLabel: string;
  commentPlaceholder?: string;
  pending: boolean;
  onConfirm: (photoUrl: string, comment: string | null) => void;
}) {
  const { t } = useTranslation();
  const photo = usePhotoCapture();
  const busy = pending || photo.uploading;
  const ready = photo.uri !== null && !busy;

  const close = () => {
    photo.reset();
    onClose();
  };

  const confirm = async () => {
    const url = await photo.upload();
    if (!url) return;
    onConfirm(url, photo.comment.trim() || null);
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title}
      subtitle={subtitle}
      badge={<PhotoRequiredBadge label={t('proof.photoRequiredBadge')} />}
    >
      {photo.uri ? (
        <View>
          <Image source={{ uri: photo.uri }} style={s.preview} resizeMode="cover" />
          <Pressable onPress={() => void photo.take()} style={s.retake} accessibilityRole="button">
            <Text style={s.retakeText}>{t('delivery.retakePhoto')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => void photo.take()} style={s.dropzone} accessibilityRole="button">
          <Icon name="camera" size={30} color={colors.slate} strokeWidth={1.7} />
          <Text style={s.dropzoneText}>{t('delivery.takePhoto')}</Text>
        </Pressable>
      )}

      <View>
        <Text style={s.label}>{t('proof.commentOptional')}</Text>
        <TextInput
          style={s.input}
          value={photo.comment}
          onChangeText={photo.setComment}
          placeholder={commentPlaceholder}
          placeholderTextColor={colors.slateLt}
          maxLength={500}
        />
      </View>

      <View>
        <Pressable
          onPress={() => void confirm()}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          style={[s.confirm, !ready && s.confirmOff]}
        >
          <Text style={[s.confirmText, !ready && s.confirmTextOff]}>
            {photo.uploading ? t('delivery.uploadingPhoto') : confirmLabel}
          </Text>
        </Pressable>
        {!photo.uri && <Text style={s.hint}>{t('proof.takePhotoFirst')}</Text>}
      </View>

      <Pressable onPress={close} style={s.cancel} accessibilityRole="button">
        <Text style={s.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  dropzone: {
    height: 156,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.mist,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dropzoneText: { fontSize: 15, fontWeight: '700', color: colors.graphite },
  preview: { height: 156, borderRadius: 14, backgroundColor: colors.mist },
  retake: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    height: 32,
    justifyContent: 'center',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
  },
  retakeText: { fontSize: 12, fontWeight: '700', color: colors.graphite },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.slate,
  },
  input: {
    marginTop: 6,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
    fontSize: 15,
    color: colors.ink,
  },
  confirm: {
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOff: { backgroundColor: colors.mist },
  confirmText: { fontSize: 17, fontWeight: '800', color: colors.onAccent },
  confirmTextOff: { color: colors.slateLt },
  hint: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: colors.brandDark,
  },
  cancel: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.slate },
});
