package com.postback.sdk

import android.content.Context
import android.content.SharedPreferences
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 轻量 Android 回传 SDK（单文件版）
 *
 * 支持两套事件版本：
 * - v2（推荐）：install_open、register、ftd、deposit
 * - v1（兼容）：install、first_open、register、ftd、deposit
 */
class PostbackAndroidSdk private constructor(
    context: Context,
    private val baseUrl: String,
    private val appKey: String,
    private val okHttpClient: OkHttpClient,
    private val logger: ((String) -> Unit)?
) {
    private val prefs: SharedPreferences = context.getSharedPreferences("postback_sdk", Context.MODE_PRIVATE)
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    data class Attribution(
        val clickId: String? = null,
        val ttclid: String? = null,
        val fbc: String? = null
    )

    data class User(
        val oaUid: String? = null,
        val ifa: String? = null,
        val externalId: String? = null,
        val email: String? = null,
        val phone: String? = null
    )

    class Builder(private val context: Context) {
        private var baseUrl: String = ""
        private var appKey: String = ""
        private var okHttpClient: OkHttpClient = OkHttpClient.Builder().build()
        private var logger: ((String) -> Unit)? = null

        fun baseUrl(value: String) = apply { baseUrl = value.trim().trimEnd('/') }
        fun appKey(value: String) = apply { appKey = value.trim() }
        fun okHttpClient(value: OkHttpClient) = apply { okHttpClient = value }
        fun logger(value: (String) -> Unit) = apply { logger = value }

        fun build(): PostbackAndroidSdk {
            require(baseUrl.isNotBlank()) { "baseUrl 不能为空" }
            require(appKey.isNotBlank()) { "appKey 不能为空" }
            return PostbackAndroidSdk(context.applicationContext, baseUrl, appKey, okHttpClient, logger)
        }
    }

    fun saveAttribution(attribution: Attribution) {
        prefs.edit()
            .putString("click_id", attribution.clickId)
            .putString("ttclid", attribution.ttclid)
            .putString("fbc", attribution.fbc)
            .apply()
    }

    fun trackInstallOpenOnce(user: User) {
        if (prefs.getBoolean("install_open_sent", false)) {
            logger?.invoke("install_open 已发送，跳过")
            return
        }

        trackEvent("install_open", user, null) {
            prefs.edit().putBoolean("install_open_sent", true).apply()
        }
    }

    fun trackInstallOnce(user: User) {
        if (prefs.getBoolean("install_sent", false)) {
            logger?.invoke("install 已发送，跳过")
            return
        }

        trackEvent("install", user, null) {
            prefs.edit().putBoolean("install_sent", true).apply()
        }
    }

    fun trackFirstOpenOnce(user: User) {
        if (prefs.getBoolean("first_open_sent", false)) {
            logger?.invoke("first_open 已发送，跳过")
            return
        }

        trackEvent("first_open", user, null) {
            prefs.edit().putBoolean("first_open_sent", true).apply()
        }
    }

    fun trackRegister(user: User) {
        trackEvent("register", user, null)
    }

    fun trackFtd(user: User, amount: Double, currency: String = "USD", depositId: String? = null) {
        val custom = JSONObject()
            .put("value", amount)
            .put("currency", currency)
        if (!depositId.isNullOrBlank()) {
            custom.put("deposit_id", depositId)
        }
        trackEvent("ftd", user, custom)
    }

    fun trackDeposit(user: User, amount: Double, currency: String = "USD", depositId: String? = null) {
        val custom = JSONObject()
            .put("value", amount)
            .put("currency", currency)
        if (!depositId.isNullOrBlank()) {
            custom.put("deposit_id", depositId)
        }
        trackEvent("deposit", user, custom)
    }

    private fun trackEvent(
        eventName: String,
        user: User,
        customData: JSONObject?,
        onSuccess: (() -> Unit)? = null
    ) {
        val payload = JSONObject()
            .put("app_key", appKey)
            .put("event_name", eventName)
            .put("event_uid", UUID.randomUUID().toString())

        if (!user.oaUid.isNullOrBlank()) payload.put("oa_uid", user.oaUid)
        if (!user.ifa.isNullOrBlank()) payload.put("ifa", user.ifa)

        val userData = JSONObject()
        if (!user.externalId.isNullOrBlank()) userData.put("external_id", user.externalId)
        if (!user.email.isNullOrBlank()) userData.put("email", user.email)
        if (!user.phone.isNullOrBlank()) userData.put("phone", user.phone)

        prefs.getString("click_id", null)?.let { userData.put("click_id", it) }
        prefs.getString("ttclid", null)?.let { userData.put("ttclid", it) }
        prefs.getString("fbc", null)?.let { userData.put("fbc", it) }

        if (userData.length() > 0) payload.put("user_data", userData)
        if (customData != null) payload.put("custom_data", customData)

        val requestBody = payload.toString()
            .toRequestBody("application/json; charset=utf-8".toMediaType())

        val request = Request.Builder()
            .url("$baseUrl/api/sdk/events")
            .post(requestBody)
            .build()

        io.execute {
            runCatching {
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}: ${response.body?.string()}")
                    }
                }
            }.onSuccess {
                logger?.invoke("事件发送成功: $eventName")
                onSuccess?.invoke()
            }.onFailure { error ->
                logger?.invoke("事件发送失败: $eventName, ${error.message}")
            }
        }
    }
}
