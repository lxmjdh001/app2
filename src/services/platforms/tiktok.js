const config = require('../../config');
const { normalizeAndHashPII, normalizeAndHashPhone } = require('../../utils/hash');

function buildEndpoint(platformConfig) {
  return platformConfig.endpoint_url || config.tiktokEndpoint;
}

function buildContext(payloadUserData = {}) {
  const user = {
    external_id: normalizeAndHashPII(payloadUserData.external_id),
    email: normalizeAndHashPII(payloadUserData.email),
    phone_number: normalizeAndHashPhone(payloadUserData.phone),
    ip: payloadUserData.client_ip_address,
    user_agent: payloadUserData.client_user_agent,
    ttclid: payloadUserData.ttclid
  };

  return {
    user: Object.fromEntries(Object.entries(user).filter(([, value]) => Boolean(value)))
  };
}

async function sendTikTokPostback({ event, platformConfig }) {
  const endpoint = buildEndpoint(platformConfig);
  const payload = event.payload || {};

  const pixelCode = platformConfig.pixel_key || platformConfig.config_json?.pixel_code;
  if (!pixelCode) {
    throw new Error('TikTok pixel_code missing in platform_configs.config_json');
  }

  const body = {
    pixel_code: pixelCode,
    event: event.platform_event_name || event.event_name,
    event_id: payload.event_id || event.id,
    timestamp: Math.floor(new Date(event.event_time).getTime() / 1000),
    context: buildContext(payload.user_data),
    properties: payload.custom_data || {}
  };

  const headers = {
    'Content-Type': 'application/json'
  };

  if (platformConfig.access_token) {
    headers['Access-Token'] = platformConfig.access_token;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`TikTok API ${response.status}: ${responseText}`);
  }

  return {
    status: response.status,
    body: responseText
  };
}

module.exports = {
  sendTikTokPostback
};
