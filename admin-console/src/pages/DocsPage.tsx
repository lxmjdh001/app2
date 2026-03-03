import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useMemo, useState } from 'react';

type DocVersion = 'v2' | 'v1';
type CodeLang = 'kotlin' | 'java';

const gradleCode = `// app/build.gradle
implementation("com.squareup.okhttp3:okhttp:4.12.0")`;

const manifestPermissionCode = `<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`;

const trackLinkExample = `https://api.your-domain.com/track/click
  ?app_key=app_xxx
  &redirect=https%3A%2F%2Fyour-landing.com
  &platform=tiktok
  &campaign=buyer_a
  &ttclid=__TTCLID__
  &fbc=__FBC__`;

const sdkEventPayloadExample = `POST /api/sdk/events
Content-Type: application/json

{
  "app_key": "app_xxx",
  "event_name": "install_open",
  "event_uid": "evt_171000000001",
  "oa_uid": "user_1001",
  "ifa": "gaid_or_idfa",
  "user_data": {
    "ttclid": "xxxx",
    "fbc": "xxxx"
  },
  "custom_data": {
    "value": 50,
    "currency": "USD"
  }
}`;

const codeSnippets = {
  kotlin: {
    init: `// 建议放在 Application.onCreate()
val sdk = PostbackAndroidSdk.Builder(applicationContext)
  .baseUrl("https://api.your-domain.com")
  .appKey("app_从后台App管理复制")
  .logger { msg -> android.util.Log.d("PostbackSdk", msg) }
  .build()`,
    attribution: `// 从落地页 / 深链参数中保存归因键（推荐）
sdk.saveAttribution(
  PostbackAndroidSdk.Attribution(
    clickId = clickId,
    ttclid = ttclid,
    fbc = fbc
  )
)`,
    installOpen: `// v2 推荐：安装打开（只发一次）
sdk.trackInstallOpenOnce(
  PostbackAndroidSdk.User(
    oaUid = userIdOrDeviceId,
    ifa = gaidOrNull
  )
)`,
    install: `// v1 兼容：安装（只发一次）
sdk.trackInstallOnce(
  PostbackAndroidSdk.User(
    oaUid = userIdOrDeviceId,
    ifa = gaidOrNull
  )
)`,
    firstOpen: `// v1 兼容：首次打开（只发一次）
sdk.trackFirstOpenOnce(
  PostbackAndroidSdk.User(
    oaUid = userIdOrDeviceId,
    ifa = gaidOrNull
  )
)`,
    register: `// 注册成功后调用
sdk.trackRegister(
  PostbackAndroidSdk.User(
    oaUid = userId,
    ifa = gaidOrNull,
    externalId = userId,
    email = userEmail
  )
)`,
    ftd: `// 首存成功后调用（可选）
sdk.trackFtd(
  user = PostbackAndroidSdk.User(oaUid = userId, ifa = gaidOrNull),
  amount = 50.0,
  currency = "USD",
  depositId = orderId
)`
  },
  java: {
    init: `// 建议放在 Application.onCreate()
PostbackAndroidSdk sdk = new PostbackAndroidSdk.Builder(getApplicationContext())
    .baseUrl("https://api.your-domain.com")
    .appKey("app_从后台App管理复制")
    .logger(msg -> android.util.Log.d("PostbackSdk", msg))
    .build();`,
    attribution: `// 从落地页 / 深链参数中保存归因键（推荐）
sdk.saveAttribution(new PostbackAndroidSdk.Attribution(
    clickId,
    ttclid,
    fbc
));`,
    installOpen: `// v2 推荐：安装打开（只发一次）
sdk.trackInstallOpenOnce(new PostbackAndroidSdk.User(
    userIdOrDeviceId,
    gaidOrNull,
    null,
    null,
    null
));`,
    install: `// v1 兼容：安装（只发一次）
sdk.trackInstallOnce(new PostbackAndroidSdk.User(
    userIdOrDeviceId,
    gaidOrNull,
    null,
    null,
    null
));`,
    firstOpen: `// v1 兼容：首次打开（只发一次）
sdk.trackFirstOpenOnce(new PostbackAndroidSdk.User(
    userIdOrDeviceId,
    gaidOrNull,
    null,
    null,
    null
));`,
    register: `// 注册成功后调用
sdk.trackRegister(new PostbackAndroidSdk.User(
    userId,
    gaidOrNull,
    userId,
    userEmail,
    null
));`,
    ftd: `// 首存成功后调用（可选）
sdk.trackFtd(
    new PostbackAndroidSdk.User(userId, gaidOrNull, null, null, null),
    50.0,
    "USD",
    orderId
);`
  }
};

function CodeBlock({ code }: { code: string }) {
  return (
    <Box
      component="pre"
      sx={{
        p: 2,
        borderRadius: 1,
        bgcolor: 'grey.100',
        overflowX: 'auto',
        fontSize: 13,
        lineHeight: 1.5,
        m: 0
      }}
    >
      {code}
    </Box>
  );
}

export function DocsPage() {
  const [version, setVersion] = useState<DocVersion>('v2');
  const [language, setLanguage] = useState<CodeLang>('kotlin');

  const versionDesc = useMemo(() => {
    if (version === 'v2') {
      return 'v2（推荐）：install_open + register。新项目优先用 v2。';
    }
    return 'v1（兼容）：install + first_open + register。只给老项目兼容使用。';
  }, [version]);

  const code = codeSnippets[language];
  const sdkFile = language === 'kotlin' ? 'postback-android-sdk.kt' : 'postback-android-sdk.java';

  return (
    <Stack spacing={2}>
      <Typography variant="h5">配置文档（开发者接入）</Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">文档版本与语言</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                select
                label="版本"
                value={version}
                onChange={(e) => setVersion(e.target.value as DocVersion)}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="v2">v2（推荐）</MenuItem>
                <MenuItem value="v1">v1（兼容）</MenuItem>
              </TextField>

              <TextField
                select
                label="语言"
                value={language}
                onChange={(e) => setLanguage(e.target.value as CodeLang)}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="kotlin">Kotlin</MenuItem>
                <MenuItem value="java">Java</MenuItem>
              </TextField>
            </Stack>
            <Alert severity="info">{versionDesc}</Alert>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`当前语言：${language === 'kotlin' ? 'Kotlin' : 'Java'}`} color="primary" size="small" />
              <Chip label={`事件版本：${version.toUpperCase()}`} color="primary" variant="outlined" size="small" />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Alert severity="warning">
        接入前先在“App管理”创建 App 并复制 `app_key`。`app_key` 必须同时用于：
        SDK 初始化 `appKey(...)` 与投放链接 `app_key=...`，两边必须一致。
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">1) 接入前准备</Typography>
            <Typography variant="body2">- 准备 API 域名（示例：`https://api.your-domain.com`）</Typography>
            <Typography variant="body2">- 从后台复制 `app_key`（每个 App 唯一）</Typography>
            <Typography variant="body2">- 事件命名统一使用：install_open / install / first_open / register / ftd / deposit</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">2) 安装 SDK 与依赖</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button component="a" href="/sdk/postback-android-sdk.kt" download variant="contained" startIcon={<DownloadIcon />}>
                下载 Kotlin SDK
              </Button>
              <Button component="a" href="/sdk/postback-android-sdk.java" download variant="outlined" startIcon={<DownloadIcon />}>
                下载 Java SDK
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              当前语言建议使用文件：`{sdkFile}`（单文件，可直接放入项目）。
            </Typography>

            <Typography variant="subtitle2">Gradle 依赖</Typography>
            <CodeBlock code={gradleCode} />

            <Typography variant="subtitle2">AndroidManifest 权限</Typography>
            <CodeBlock code={manifestPermissionCode} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">3) 初始化 SDK（Application）</Typography>
            <CodeBlock code={code.init} />
            <Typography variant="body2">建议同时保存归因参数（来自落地页/深链）：</Typography>
            <CodeBlock code={code.attribution} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">4) 业务埋点调用</Typography>

            {version === 'v2' ? (
              <>
                <Typography variant="body2">步骤 A：安装打开（首次进入主流程时调用，SDK 内部只发一次）</Typography>
                <CodeBlock code={code.installOpen} />
              </>
            ) : (
              <>
                <Typography variant="body2">步骤 A1：安装（只发一次）</Typography>
                <CodeBlock code={code.install} />
                <Typography variant="body2">步骤 A2：首次打开（只发一次）</Typography>
                <CodeBlock code={code.firstOpen} />
              </>
            )}

            <Typography variant="body2">步骤 B：注册成功后调用</Typography>
            <CodeBlock code={code.register} />

            <Typography variant="body2">步骤 C：首存事件（可选）</Typography>
            <CodeBlock code={code.ftd} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">5) 投放链接与接口格式</Typography>
            <Typography variant="subtitle2">追踪链接示例（广告点击入口）</Typography>
            <CodeBlock code={trackLinkExample} />

            <Typography variant="subtitle2">事件上报 JSON 示例（SDK 最终调用）</Typography>
            <CodeBlock code={sdkEventPayloadExample} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">6) 联调验证与排错</Typography>
            <Typography variant="body2">- 后台 `事件与队列` 页面，确认出现新任务且状态变成 `done`。</Typography>
            <Typography variant="body2">- 若看不到归因来源，先检查追踪链接是否带了 `campaign/ttclid/fbc`。</Typography>
            <Typography variant="body2">- 若回传失败，优先检查像素 `access_token`、`pixel_id/pixel_code`、平台 endpoint。</Typography>
            <Typography variant="body2">- 若无事件入库，检查 App 端 `baseUrl` 与 `app_key` 是否正确且一致。</Typography>
            <Typography variant="body2">- 每次事件必须唯一 `event_uid`（SDK 已自动生成）。</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary">
        本文档按当前系统接口定制：`/track/click` + `/api/sdk/events`。
      </Typography>
    </Stack>
  );
}
