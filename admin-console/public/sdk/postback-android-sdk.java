package com.postback.sdk;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * 轻量 Android 回传 SDK（Java 单文件版）
 *
 * 支持两套事件版本：
 * - v2（推荐）：install_open、register、ftd、deposit
 * - v1（兼容）：install、first_open、register、ftd、deposit
 */
public class PostbackAndroidSdk {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private final SharedPreferences prefs;
    private final ExecutorService io;
    private final String baseUrl;
    private final String appKey;
    private final OkHttpClient okHttpClient;
    private final Logger logger;

    public interface Logger {
        void log(String msg);
    }

    public static class Attribution {
        public final String clickId;
        public final String ttclid;
        public final String fbc;

        public Attribution(String clickId, String ttclid, String fbc) {
            this.clickId = clickId;
            this.ttclid = ttclid;
            this.fbc = fbc;
        }
    }

    public static class User {
        public final String oaUid;
        public final String ifa;
        public final String externalId;
        public final String email;
        public final String phone;

        public User(String oaUid, String ifa, String externalId, String email, String phone) {
            this.oaUid = oaUid;
            this.ifa = ifa;
            this.externalId = externalId;
            this.email = email;
            this.phone = phone;
        }
    }

    public static class Builder {
        private final Context context;
        private String baseUrl = "";
        private String appKey = "";
        private OkHttpClient okHttpClient = new OkHttpClient.Builder().build();
        private Logger logger;

        public Builder(Context context) {
            this.context = context;
        }

        public Builder baseUrl(String value) {
            this.baseUrl = value == null ? "" : value.trim();
            if (this.baseUrl.endsWith("/")) {
                this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length() - 1);
            }
            return this;
        }

        public Builder appKey(String value) {
            this.appKey = value == null ? "" : value.trim();
            return this;
        }

        public Builder okHttpClient(OkHttpClient value) {
            this.okHttpClient = value;
            return this;
        }

        public Builder logger(Logger value) {
            this.logger = value;
            return this;
        }

        public PostbackAndroidSdk build() {
            if (baseUrl.isEmpty()) {
                throw new IllegalArgumentException("baseUrl 不能为空");
            }
            if (appKey.isEmpty()) {
                throw new IllegalArgumentException("appKey 不能为空");
            }
            return new PostbackAndroidSdk(context.getApplicationContext(), baseUrl, appKey, okHttpClient, logger);
        }
    }

    private PostbackAndroidSdk(
        Context context,
        String baseUrl,
        String appKey,
        OkHttpClient okHttpClient,
        Logger logger
    ) {
        this.prefs = context.getSharedPreferences("postback_sdk", Context.MODE_PRIVATE);
        this.io = Executors.newSingleThreadExecutor();
        this.baseUrl = baseUrl;
        this.appKey = appKey;
        this.okHttpClient = okHttpClient;
        this.logger = logger;
    }

    public void saveAttribution(Attribution attribution) {
        prefs.edit()
            .putString("click_id", attribution == null ? null : attribution.clickId)
            .putString("ttclid", attribution == null ? null : attribution.ttclid)
            .putString("fbc", attribution == null ? null : attribution.fbc)
            .apply();
    }

    public void trackInstallOpenOnce(User user) {
        if (prefs.getBoolean("install_open_sent", false)) {
            log("install_open 已发送，跳过");
            return;
        }

        trackEvent("install_open", user, null, new Runnable() {
            @Override
            public void run() {
                prefs.edit().putBoolean("install_open_sent", true).apply();
            }
        });
    }

    public void trackInstallOnce(User user) {
        if (prefs.getBoolean("install_sent", false)) {
            log("install 已发送，跳过");
            return;
        }

        trackEvent("install", user, null, new Runnable() {
            @Override
            public void run() {
                prefs.edit().putBoolean("install_sent", true).apply();
            }
        });
    }

    public void trackFirstOpenOnce(User user) {
        if (prefs.getBoolean("first_open_sent", false)) {
            log("first_open 已发送，跳过");
            return;
        }

        trackEvent("first_open", user, null, new Runnable() {
            @Override
            public void run() {
                prefs.edit().putBoolean("first_open_sent", true).apply();
            }
        });
    }

    public void trackRegister(User user) {
        trackEvent("register", user, null, null);
    }

    public void trackFtd(User user, double amount, String currency, String depositId) {
        JSONObject custom = new JSONObject();
        try {
            custom.put("value", amount);
            custom.put("currency", currency == null ? "USD" : currency);
            if (depositId != null && !depositId.trim().isEmpty()) {
                custom.put("deposit_id", depositId);
            }
        } catch (Exception ignored) {
        }

        trackEvent("ftd", user, custom, null);
    }

    public void trackDeposit(User user, double amount, String currency, String depositId) {
        JSONObject custom = new JSONObject();
        try {
            custom.put("value", amount);
            custom.put("currency", currency == null ? "USD" : currency);
            if (depositId != null && !depositId.trim().isEmpty()) {
                custom.put("deposit_id", depositId);
            }
        } catch (Exception ignored) {
        }

        trackEvent("deposit", user, custom, null);
    }

    private void trackEvent(final String eventName, final User user, final JSONObject customData, final Runnable onSuccess) {
        final JSONObject payload = new JSONObject();

        try {
            payload.put("app_key", appKey);
            payload.put("event_name", eventName);
            payload.put("event_uid", UUID.randomUUID().toString());

            if (user != null) {
                if (notBlank(user.oaUid)) payload.put("oa_uid", user.oaUid);
                if (notBlank(user.ifa)) payload.put("ifa", user.ifa);
            }

            JSONObject userData = new JSONObject();
            if (user != null) {
                if (notBlank(user.externalId)) userData.put("external_id", user.externalId);
                if (notBlank(user.email)) userData.put("email", user.email);
                if (notBlank(user.phone)) userData.put("phone", user.phone);
            }

            putPrefsIfPresent(userData, "click_id");
            putPrefsIfPresent(userData, "ttclid");
            putPrefsIfPresent(userData, "fbc");

            if (userData.length() > 0) {
                payload.put("user_data", userData);
            }

            if (customData != null) {
                payload.put("custom_data", customData);
            }
        } catch (Exception error) {
            log("构建事件失败: " + eventName + ", " + error.getMessage());
            return;
        }

        final RequestBody requestBody = RequestBody.create(payload.toString(), JSON);
        final Request request = new Request.Builder()
            .url(baseUrl + "/api/sdk/events")
            .post(requestBody)
            .build();

        io.execute(new Runnable() {
            @Override
            public void run() {
                Response response = null;
                try {
                    response = okHttpClient.newCall(request).execute();
                    if (!response.isSuccessful()) {
                        String body = response.body() == null ? "" : response.body().string();
                        throw new IllegalStateException("HTTP " + response.code() + ": " + body);
                    }

                    log("事件发送成功: " + eventName);
                    if (onSuccess != null) {
                        onSuccess.run();
                    }
                } catch (Exception error) {
                    log("事件发送失败: " + eventName + ", " + error.getMessage());
                } finally {
                    if (response != null) {
                        response.close();
                    }
                }
            }
        });
    }

    private void putPrefsIfPresent(JSONObject userData, String key) {
        try {
            String value = prefs.getString(key, null);
            if (notBlank(value)) {
                userData.put(key, value);
            }
        } catch (Exception ignored) {
        }
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private void log(String msg) {
        if (logger != null) {
            logger.log(msg);
        }
    }
}
