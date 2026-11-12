import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  formatUzLocalPhone,
  loginSchema,
  UZ_PHONE_LOCAL_DISPLAY_LENGTH,
  type LoginInput,
} from '@bigant/shared';
import { lastPhone, useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { colors } from '../components/theme';
import { Icon } from '../components/Icon';

export function LoginScreen() {
  const { login } = useAuth();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone_number: '', password: '' },
  });

  // The number he last signed in with is already there (owner, 09.11.2026).
  useEffect(() => {
    void lastPhone().then((p) => {
      if (p) setValue('phone_number', p);
    });
  }, [setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.phone_number, values.password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? t('login.invalidCredentials')
          : t('login.genericError'),
      );
    }
  });

  return (
    <SafeAreaView style={s.safe}>
      {/* Android 15 draws the app edge to edge and no longer shrinks it for
          the keyboard, which then covered the password field. Padding for the
          keyboard on both platforms, and a scroll so the button can be reached. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>
          BIG<Text style={{ color: colors.brand }}>ANT</Text>
        </Text>
        {/* The error takes the place the subtitle had, under the logo (owner, 09.11.2026). */}
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.fieldWrap}>
          <Text style={s.label}>{t('login.phone')}</Text>
          <Controller
            control={control}
            name="phone_number"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={s.input}
                placeholderTextColor={colors.slateLt}
                keyboardType="phone-pad"
                autoComplete="username"
                importantForAutofill="yes"
                maxLength={UZ_PHONE_LOCAL_DISPLAY_LENGTH}
                placeholder="90 123 45 67"
                onBlur={onBlur}
                onChangeText={(text) => onChange(formatUzLocalPhone(text))}
                value={formatUzLocalPhone(value)}
              />
            )}
          />
          {errors.phone_number ? (
            <Text style={s.fieldError}>{errors.phone_number.message}</Text>
          ) : null}
        </View>

        <View style={[s.fieldWrap, { marginTop: 16 }]}>
          <Text style={s.label}>{t('login.password')}</Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              // The eye shows what was typed (owner, 11.11.2026).
              <View style={s.passWrap}>
                <TextInput
                  style={[s.input, s.passInput]}
                  placeholder="••••••••"
                  placeholderTextColor={colors.slateLt}
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  importantForAutofill="yes"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
                <Pressable
                  onPress={() => setShowPass((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPass ? t('login.hidePassword') : t('login.showPassword')}
                  hitSlop={10}
                  style={s.eye}
                >
                  <Icon name={showPass ? 'eye-off' : 'eye'} size={22} color={colors.slate} />
                </Pressable>
              </View>
            )}
          />
          {errors.password ? <Text style={s.fieldError}>{errors.password.message}</Text> : null}
        </View>

        <Pressable
          onPress={onSubmit}
          disabled={isSubmitting}
          style={[s.btn, isSubmitting && { opacity: 0.6 }]}
        >
          <Text style={s.btnText}>{isSubmitting ? t('login.signingIn') : t('login.signIn')}</Text>
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  logo: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5, color: colors.ink },
  subtitle: { marginTop: 4, fontSize: 15, color: colors.slate, fontWeight: '600' },
  errorBox: {
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: '#fdeaea',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: { fontSize: 14, color: colors.danger },
  fieldWrap: { marginTop: 32 },
  label: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.slateLt,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.paper,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.ink,
  },
  fieldError: { marginTop: 4, fontSize: 12, color: colors.danger },
  passWrap: { justifyContent: 'center' },
  passInput: { paddingRight: 52 },
  eye: { position: 'absolute', right: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  btn: {
    marginTop: 24,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: colors.brand,
    paddingVertical: 16,
  },
  btnText: { fontSize: 16, fontWeight: '700', color: colors.onAccent },
});
