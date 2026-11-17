import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "konsta/react";
import { ListItem, Toggle } from "framework7-react";
import { tg, getUser, haptic, type TgBiometricManager } from "../lib/telegram";
import "./WalletBiometrics.css";
import Aurora from "../components/reactbits/Aurora";
import WalletLockBadge from "./WalletLockBadge";
import AppPreloader from "../components/AppPreloader";

// Device privacy lock only. Server authentication and financial authorization remain independent.
function nativeCall<T>(
  invoke: (done: (value: T) => void) => void,
  timeout = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          Error(
            "Telegram не ответил. Закройте окно подтверждения и повторите попытку.",
          ),
        );
      }
    }, timeout);
    try {
      invoke((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Error("Биометрия Telegram сейчас недоступна."));
      }
    }
  });
}
function manager(): TgBiometricManager | null {
  const app = tg();
  if (!app?.BiometricManager || app.isVersionAtLeast?.("7.2") === false)
    return null;
  return app.BiometricManager;
}
const key = () => `wpay:biometric-lock:v1:${getUser()?.id ?? "guest"}`;
function hint() {
  try {
    return localStorage.getItem(key()) === "enabled";
  } catch {
    return false;
  }
}
function confirmedDisabled() {
  try {
    return localStorage.getItem(key()) === "disabled";
  } catch {
    return false;
  }
}
function saveHint(enabled: boolean) {
  if (enabled) localStorage.setItem(key(), "enabled");
  else localStorage.setItem(key(), "disabled");
}
function obscured(value: boolean) {
  document.documentElement.classList.toggle("wpay-biometric-obscured", value);
}
export function FaceIdIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 28"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4H7a3 3 0 0 0-3 3v3m14-6h3a3 3 0 0 1 3 3v3M4 18v3a3 3 0 0 0 3 3h3m8 0h3a3 3 0 0 0 3-3v-3M10 10v2m8-2v2m-4-2v5h-2m-2 3c2 2 6 2 8 0" />
    </svg>
  );
}
type BiometricState = {
  ready: boolean;
  enabled: boolean;
  available: boolean;
  busy: boolean;
  label: string;
  locked: boolean;
  error: string;
  setEnabled: (next: boolean) => Promise<boolean>;
};
const Context = createContext<BiometricState | null>(null);
export function WalletBiometricGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false),
    [enabled, setEnabledState] = useState(false),
    [available, setAvailable] = useState(false),
    [label, setLabel] = useState("Face ID"),
    [locked, setLocked] = useState(false),
    [allowed, setAllowed] = useState(false),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const alive = useRef(true),
    enabledRef = useRef(false),
    busyRef = useRef(false),
    background = useRef(false);
  const remember = useCallback((next: boolean) => {
    enabledRef.current = next;
    if (alive.current) setEnabledState(next);
  }, []);
  const capability = useCallback((bio: TgBiometricManager | null) => {
    if (!alive.current) return;
    setAvailable(Boolean(bio?.isBiometricAvailable));
    setLabel(
      bio?.biometricType === "finger"
        ? tg()?.platform === "ios" || tg()?.platform === "macos"
          ? "Touch ID"
          : "Отпечаток пальца"
        : bio?.biometricType === "unknown" && bio.isBiometricAvailable
          ? "Биометрия"
          : "Face ID",
    );
  }, []);
  const begin = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    if (alive.current) {
      setBusy(true);
      setError("");
    }
    return true;
  }, []);
  const end = useCallback(() => {
    busyRef.current = false;
    if (alive.current) {
      setBusy(false);
      if (
        enabledRef.current &&
        (background.current || document.visibilityState === "hidden")
      ) {
        setApproved(false);
        obscured(true);
        setLocked(true);
      }
    }
  }, []);
  const access = useCallback(
    async (bio: TgBiometricManager, interactive: boolean) => {
      if (!bio.isBiometricAvailable)
        throw Error("На этом устройстве биометрия недоступна.");
      if (bio.isAccessGranted) return;
      if (!interactive)
        throw Error("Разрешите биометрию для WPay в настройках Telegram.");
      if (bio.isAccessRequested && !bio.isAccessGranted) {
        bio.openSettings();
        throw Error(
          "Разрешите доступ в настройках Telegram и повторите попытку.",
        );
      }
      const granted = await nativeCall<boolean>((done) => {
        bio.requestAccess(
          { reason: "Разрешить вход в WPay с помощью биометрии устройства" },
          done,
        );
      });
      if (!granted)
        throw Error("Доступ к биометрии не разрешён. Защита не включена.");
    },
    [],
  );
  const authenticate = useCallback(
    async (bio: TgBiometricManager, reason: string) => {
      const ok = await nativeCall<boolean>((done) => {
        bio.authenticate({ reason }, (success) => done(success));
      });
      if (!ok) throw Error("Подтверждение отменено. Попробуйте ещё раз.");
    },
    [],
  );
  const store = useCallback(async (bio: TgBiometricManager, next: boolean) => {
    const marker = next ? "wpay-lock-v1:" + crypto.randomUUID() : "";
    const ok = await nativeCall<boolean>((done) => {
      bio.updateBiometricToken(marker, done);
    });
    if (!ok)
      throw Object.assign(
        Error("Telegram не сохранил настройку. Попробуйте ещё раз."),
        { definitive: true },
      );
  }, []);
  const unlock = useCallback(
    async (interactive = true) => {
      if (!begin()) return;
      try {
        const bio = manager();
        if (!bio || !bio.isInited)
          throw Error("Откройте WPay в Telegram на устройстве с биометрией.");
        await access(bio, interactive);
        await authenticate(bio, "Подтвердите вход в WPay");
        // Recover a missing device marker only after successful native authentication.
        if (!bio.isBiometricTokenSaved) await store(bio, true);
        try {
          saveHint(true);
        } catch {
          /* Native secure marker still requires authentication on next launch. */
        }
        remember(true);
        if (
          alive.current &&
          !background.current &&
          document.visibilityState !== "hidden"
        ) {
          setApproved(true);
          haptic("success");
        }
      } catch (reason) {
        if (alive.current) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось подтвердить вход",
          );
          setApproved(false);
          setLocked(true);
          obscured(true);
        }
      } finally {
        end();
      }
    },
    [begin, end, access, authenticate, store, remember],
  );
  const change = useCallback(
    async (next: boolean) => {
      if (next === enabledRef.current || !begin()) return false;
      const previous = enabledRef.current;
      try {
        const bio = manager();
        if (!bio || !bio.isInited)
          throw Error(
            "Face ID доступен только в поддерживаемом приложении Telegram.",
          );
        await access(bio, true);
        await authenticate(
          bio,
          next
            ? "Подтвердите включение защиты WPay"
            : "Подтвердите отключение защиты WPay",
        );
        // Enabling is fail-closed; disabled is recorded only after native removal succeeds.
        if (next) saveHint(true);
        try {
          await store(bio, next);
          if (!next) saveHint(false);
        } catch (reason) {
          if (next && !(reason instanceof Error && "definitive" in reason)) {
            // A timed-out enable may have succeeded natively; keep protection on.
            remember(true);
          } else {
            try {
              saveHint(previous);
            } catch {
              /* Native state remains authoritative. */
            }
          }
          throw reason;
        }
        remember(next);
        if (!next && alive.current) {
          setApproved(false);
          setLocked(false);
          setAllowed(true);
          setError("");
          obscured(false);
        }
        haptic("success");
        return true;
      } catch (reason) {
        const message =
          reason instanceof Error
            ? reason.message
            : "Не удалось изменить настройку";
        if (alive.current) setError(message);
        throw Error(message);
      } finally {
        end();
      }
    },
    [access, authenticate, store, remember, begin, end],
  );
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let initializing = true;
    const desktopClient = () => {
      const app = tg();
      return (
        !app ||
        ["tdesktop", "macos", "unigram", "web", "weba", "webk"].includes(
          app.platform || "",
        ) ||
        (app.platform === "unknown" &&
          navigator.maxTouchPoints === 0 &&
          !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
      );
    };
    const allowUnsupportedDesktop = (bio: TgBiometricManager | null) => {
      if (cancelled || !desktopClient() || bio?.isBiometricAvailable)
        return false;
      initializing = false;
      capability(bio);
      remember(false);
      setReady(true);
      setAllowed(true);
      setApproved(false);
      setLocked(false);
      setError("");
      obscured(false);
      // This is a capability decision for this client, not a change to the
      // saved setting or native token on any device.
      return true;
    };
    const applyNativeState = (bio: TgBiometricManager) => {
      if (cancelled || !initializing || !bio.isInited) return;
      if (allowUnsupportedDesktop(bio)) return;
      initializing = false;
      capability(bio);
      const protectedDevice = bio.isBiometricTokenSaved || hint();
      remember(protectedDevice);
      setLocked(protectedDevice);
      setAllowed(!protectedDevice);
      setReady(true);
      setError("");
      obscured(protectedDevice);
      if (!protectedDevice) {
        try {
          saveHint(false);
        } catch {
          /* Native absence has still been confirmed. */
        }
      }
      if (protectedDevice) void unlock(false);
    };
    const initialize = async () => {
      try {
        const bio = manager();
        const disabled = confirmedDisabled() && !hint();
        if (disabled && !bio?.isBiometricTokenSaved) {
          // A previous successful disable must not wait for Telegram at each launch.
          remember(false);
          setReady(true);
          setAllowed(true);
          setLocked(false);
          obscured(false);
        }
        if (!bio) {
          if (allowUnsupportedDesktop(bio)) return;
          if (cancelled) return;
          initializing = false;
          const protectedDevice = hint();
          remember(protectedDevice);
          setReady(true);
          setLocked(protectedDevice);
          setAllowed(!protectedDevice);
          obscured(protectedDevice);
          if (protectedDevice)
            setError(
              "Для разблокировки откройте WPay в Telegram с поддержкой биометрии.",
            );
          return;
        }
        tg()?.ready?.();
        if (!bio.isInited)
          await nativeCall<void>((done) => bio.init(() => done()), 5000);
        applyNativeState(bio);
      } catch {
        if (!cancelled && initializing) {
          if (allowUnsupportedDesktop(manager())) return;
          setReady(true);
          if (
            confirmedDisabled() &&
            !hint() &&
            !enabledRef.current &&
            !manager()?.isBiometricTokenSaved
          ) {
            setAllowed(true);
            setLocked(false);
            obscured(false);
          } else {
            setApproved(false);
            setLocked(true);
            obscured(true);
            setError(
              "Telegram не сообщил состояние защиты. Повторите проверку.",
            );
          }
        }
      }
    };
    const deactivate = () => {
      background.current = true;
      setApproved(false);
      if (enabledRef.current && !busyRef.current) {
        setApproved(false);
        obscured(true);
        setLocked(true);
      }
    };
    const activate = () => {
      background.current = false;
      if (enabledRef.current && !busyRef.current) {
        setApproved(false);
        obscured(true);
        setLocked(true);
        void unlock(false);
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") deactivate();
      else activate();
    };
    const updated = () => {
      const bio = manager();
      capability(bio);
      if (
        !initializing &&
        desktopClient() &&
        bio?.isInited &&
        bio.isBiometricAvailable &&
        !enabledRef.current &&
        (bio.isBiometricTokenSaved || hint())
      ) {
        // A delayed native capability response must restore a saved lock.
        initializing = true;
        applyNativeState(bio);
        return;
      }
      if (initializing && bio?.isInited) {
        applyNativeState(bio);
        return;
      }
      if (
        enabledRef.current &&
        !busyRef.current &&
        bio &&
        !bio.isAccessGranted
      ) {
        setApproved(false);
        obscured(true);
        setLocked(true);
        setError("Разрешите биометрию для WPay в настройках Telegram.");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const app = tg();
    app?.onEvent?.("deactivated", deactivate);
    app?.onEvent?.("activated", activate);
    app?.onEvent?.("biometricManagerUpdated", updated);
    void initialize();
    return () => {
      cancelled = true;
      alive.current = false;
      document.removeEventListener("visibilitychange", visibility);
      app?.offEvent?.("deactivated", deactivate);
      app?.offEvent?.("activated", activate);
      app?.offEvent?.("biometricManagerUpdated", updated);
      obscured(false);
    };
  }, [capability, remember, unlock, initializationAttempt]);
  const hidden = !ready || locked;
  const needsInitialization = ready && manager()?.isInited === false;
  return (
    <Context.Provider
      value={{
        ready,
        enabled,
        available,
        busy,
        label,
        locked,
        error,
        setEnabled: change,
      }}
    >
      {allowed && (
        <div
          className="wpay-biometric-content"
          aria-hidden={hidden}
          inert={hidden}
        >
          {children}
        </div>
      )}
      {hidden && (
        <main className="wpay-lock-screen" aria-label="Блокировка WPay">
          <div className="wpay-lock-aurora" aria-hidden="true">
            <Aurora
              colorStops={["#264575", "#6872b8", "#3654a4"]}
              speed={0.22}
              amplitude={0.65}
              height={0.7}
              glow={0.25}
              opacity={0.6}
              layers={2}
              mouseInteraction={false}
              intro={false}
              dpr={1}
            />
          </div>
          {ready && locked && <WalletLockBadge />}
          <div
            className={`wpay-lock-copy${!ready ? " wpay-lock-copy--checking" : ""}`}
          >
            {ready ? (
              <>
                <h1>{approved ? "Добро пожаловать" : "wPay заблокирован"}</h1>
                <p>
                  {approved
                    ? "Вход подтверждён"
                    : `Подтвердите вход с помощью ${label}`}
                </p>
              </>
            ) : (
              <>
                <img
                  className="wpay-lock-wordmark dark:hidden"
                  src="/brands/wpay-wordmark.svg"
                  width={282}
                  height={116}
                  alt="wPay"
                />
                <img
                  className="wpay-lock-wordmark hidden dark:block"
                  src="/brands/wpay-wordmark-light.svg"
                  width={282}
                  height={116}
                  alt="wPay"
                />
                <div
                  className="wpay-lock-checking-spinner"
                  role="status"
                  aria-label="Проверка защиты устройства"
                  aria-busy="true"
                >
                  <AppPreloader />
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="wpay-lock-error">
                {error}
              </p>
            )}
          </div>
          <div className="wpay-lock-actions">
            {ready && (
              <Button
                data-wpay-primary=""
                rounded
                disabled={busy}
                className="!m-0 !w-full"
                onClick={() => {
                  if (needsInitialization) {
                    setError("");
                    setReady(false);
                    setInitializationAttempt((attempt) => attempt + 1);
                    return;
                  }
                  if (!approved) {
                    void unlock(true);
                    return;
                  }
                  if (
                    background.current ||
                    document.visibilityState === "hidden" ||
                    busyRef.current
                  )
                    return;
                  setApproved(false);
                  obscured(false);
                  setLocked(false);
                  setAllowed(true);
                }}
              >
                <span className="wpay-unlock-label">
                  {!approved && !needsInitialization && <FaceIdIcon />}
                  <span>
                    {busy
                      ? "Подтверждение…"
                      : needsInitialization
                        ? "Повторить проверку"
                        : approved
                          ? "Открыть"
                          : "Разблокировать"}
                  </span>
                </span>
              </Button>
            )}
            {ready && (
              <button
                type="button"
                className="wpay-lock-settings"
                onClick={() => {
                  try {
                    manager()?.openSettings();
                  } catch {
                    setError(
                      "Включите биометрию в настройках устройства и Telegram.",
                    );
                  }
                }}
              >
                Настройки Telegram
              </button>
            )}
          </div>
        </main>
      )}
    </Context.Provider>
  );
}
export function WalletBiometricRow({
  showNotice,
}: {
  showNotice: (message: string) => void;
}) {
  const state = useContext(Context);
  if (!state) throw Error("Biometric gate missing");
  const subtitle = state.busy
    ? "Подтверждение в Telegram…"
    : !state.available
      ? "Недоступно"
      : state.enabled
        ? "Включён для входа в WPay"
        : "Подтверждение входа";
  return (
    <ListItem
      title={state.label}
      subtitle={subtitle}
      mediaItem
      className="wpay-biometric-row"
    >
      <span slot="media" className="wpay-face-id-icon">
        <FaceIdIcon />
      </span>
      <span slot="after">
        <Toggle
          init={false}
          name="biometric-lock"
          aria-label={state.label}
          checked={state.enabled}
          disabled={!state.ready || !state.available || state.busy}
          onChange={() => {
            // Framework7 native change can follow React restoring the controlled input.
            const next = !state.enabled;
            void state
              .setEnabled(next)
              .then((changed) => {
                if (changed)
                  showNotice(
                    next
                      ? "Биометрическая защита включена"
                      : "Биометрическая защита выключена",
                  );
              })
              .catch((reason) =>
                showNotice(
                  reason instanceof Error
                    ? reason.message
                    : "Не удалось изменить настройку",
                ),
              );
          }}
        />
      </span>
    </ListItem>
  );
}
