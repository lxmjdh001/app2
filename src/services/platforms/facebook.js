const config = require('../../config');
const { normalizeAndHashPII, normalizeAndHashPhone } = require('../../utils/hash');

function buildUserData(payloadUserData = {}) {
  const userData = {
    em: normalizeAndHashPII(payloadUserData.email),
    ph: normalizeAndHashPhone(payloadUserData.phone),
    external_id: normalizeAndHashPII(payloadUserData.external_id),
    fbc: payloadUserData.fbc,
    fbp: payloadUserData.fbp,
    client_ip_address: payloadUserData.client_ip_address,
    client_user_agent: payloadUserData.client_user_agent
  };

  return Object.fromEntries(Object.entries(userData).filter(([, value]) => Boolean(value)));
}

function buildEndpoint(platformConfig) {
  if (platformConfig.endpoint_url) {
    return platformConfig.endpoint_url;
  }

  const pixelId = platformConfig.pixel_key || platformConfig.config_json?.pixel_id;
  if (!pixelId) {
    throw new Error('Facebook pixel_id missing in platform_configs.config_json');
  }
  return `https://graph.facebook.com/${config.facebookApiVersion}/${pixelId}/events`;
}

async function sendFacebookPostback({ event, platformConfig }) {
  const endpoint = buildEndpoint(platformConfig);
  const payload = event.payload || {};
  const eventTimeSeconds = Math.floor(new Date(event.event_time).getTime() / 1000);

  const body = {
    data: [
      {
        event_name: event.platform_event_name || event.event_name,
        event_time: eventTimeSeconds,
        action_source: payload.action_source || 'app',
        event_id: payload.event_id || event.id,
        user_data: buildUserData(payload.user_data),
        custom_data: payload.custom_data || {}
      }
    ]
  };

  if (platformConfig.config_json?.test_event_code) {
    body.test_event_code = platformConfig.config_json.test_event_code;
  }

  if (platformConfig.access_token) {
    body.access_token = platformConfig.access_token;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Facebook API ${response.status}: ${responseText}`);
  }

  return {
    status: response.status,
    body: responseText
  };
}

module.exports = {
  sendFacebookPostback
};
