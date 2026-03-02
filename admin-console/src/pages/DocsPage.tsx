import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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

const codeSnippets = {
  kotlin: {
    init: `// Application 或 App 启动后初始化
val sdk = PostbackAndroidSdk.Builder(applicationContext)
  .baseUrl("https://your-domain.com")
  .appKey("app_从后台App管理复制")
  .logger { msg -> android.util.Log.d("PostbackSdk", msg) }
  .build()`,
    attribution: `// 当你从落地页/深链拿到参数后保存（可选但强烈建议）
sdk.saveAttribution(
  PostbackAndroidSdk.Attribution(
    clickId = clickId,
    ttclid = ttclid,
    fbc = fbc
  )
)`,
    installOpen: `// v2：安装打开（install_open）
// 建议在主页面首次进入时调用，SDK 内部会自动“只发一次”
sdk.trackInstallOpenOnce(
  PostbackAndroidSdk.User(
    oaUid = userIdOrDeviceId,
    ifa = gaidOrNull
  )
)`,
    install: `// v1：安装（install）
sdk.trackInstallOnce(
  PostbackAndroidSdk.User(
    oaUid = userIdOrDeviceId,
    ifa = gaidOrNull
  )
)`,
    firstOpen: `// v1：首次打开（first_open）
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
    ftd: `// 首存成功后调用
sdk.trackFtd(
  user = PostbackAndroidSdk.User(oaUid = userId, ifa = gaidOrNull),
  amount = 50.0,
  currency = "USD",
  depositId = orderId
)`
  },
  java: {
    init: `// Application 或 App 启动后初始化
PostbackAndroidSdk sdk = new PostbackAndroidSdk.Builder(getApplicationContext())
    .baseUrl("https://your-domain.com")
    .appKey("app_从后台App管理复制")
    .logger(msg -> android.util.Log.d("PostbackSdk", msg))
    .build();`,
    attribution: `// 当你从落地页/深链拿到参数后保存（可选但强烈建议）
sdk.saveAttribution(new PostbackAndroidSdk.Attribution(
    clickId,
    ttclid,
    fbc
));`,
    installOpen: `// v2：安装打开（install_open）
sdk.trackInstallOpenOnce(new PostbackAndroidSdk.User(
    userIdOrDeviceId,
    gaidOrNull,
    null,
    null,
    null
));`,
    install: `// v1：安装（install）
sdk.trackInstallOnce(new PostbackAndroidSdk.User(
    userIdOrDeviceId,
    gaidOrNull,
    null,
    null,
    null
));`,
    firstOpen: `// v1：首次打开（first_open）
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
    ftd: `// 首存成功后调用
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
      return 'v2（推荐）：上报 `install_open + register`，客户最容易理解和接入。';
    }
    return 'v1（兼容）：上报 `install + first_open + register`，用于兼容老项目。';
  }, [version]);

  const languageDesc = useMemo(() => {
    if (language === 'kotlin') {
      return '当前展示 Kotlin 接入示例。';
    }
    return '当前展示 Java 接入示例。';
  }, [language]);

  const code = codeSnippets[language];
  const sdkFile = language === 'kotlin' ? 'postback-android-sdk.kt' : 'postback-android-sdk.java';

  return (
    <Stack spacing={2}>
      <Typography variant="h5">配置文档（客户接入）</Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">选择 SDK 文档版本与语言</Typography>
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
            <Alert severity="info">{languageDesc}</Alert>
          </Stack>
        </CardContent>
      </Card>

      <Alert severity="warning">
        接入前必须先到“App管理”页面创建 App 并复制 `app_key`。同一个 `app_key` 需要同时用于：
        1) SDK 初始化 `.appKey(...)`；2) 投放链接参数 `app_key=...`。两边必须一致。
      </Alert>

      <Alert severity="info">
        下载点击由追踪链接 `/track/click` 完成；App 里只需要接入 SDK 并上报业务事件。
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">1) 下载 SDK</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button component="a" href="/sdk/postback-android-sdk.kt" download variant="contained" startIcon={<DownloadIcon />}>
                下载 Kotlin SDK
              </Button>
              <Button component="a" href="/sdk/postback-android-sdk.java" download variant="outlined" startIcon={<DownloadIcon />}>
                下载 Java SDK
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              当前示例语言建议使用文件：`{sdkFile}`（单文件，便于客户直接复制进项目）。
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">2) 客户接入步骤</Typography>
            <Typography variant="body2">步骤 A：先去“App管理”页面复制 `app_key`</Typography>
            <Typography variant="body2">步骤 B：添加依赖（OkHttp）</Typography>
            <CodeBlock code={gradleCode} />

            <Typography variant="body2">步骤 C：把 SDK 文件放到项目里并初始化（填入 app_key）</Typography>
            <CodeBlock code={code.init} />

            <Typography variant="body2">步骤 D：保存归因参数（可选但建议）</Typography>
            <CodeBlock code={code.attribution} />

            {version === 'v2' ? (
              <>
                <Typography variant="body2">步骤 E：安装打开事件（只发一次）</Typography>
                <CodeBlock code={code.installOpen} />
              </>
            ) : (
              <>
                <Typography variant="body2">步骤 E1：安装事件（只发一次）</Typography>
                <CodeBlock code={code.install} />
                <Typography variant="body2">步骤 E2：首次打开事件（只发一次）</Typography>
                <CodeBlock code={code.firstOpen} />
              </>
            )}

            <Typography variant="body2">步骤 F：注册事件</Typography>
            <CodeBlock code={code.register} />

            <Typography variant="body2">步骤 G：可选付费事件（FTD/Deposit）</Typography>
            <CodeBlock code={code.ftd} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">3) 客户只需记住这些点</Typography>
            <Typography variant="body2">- `app_key` 是必填，且 SDK 与投放链接必须一致。</Typography>
            <Typography variant="body2">- 下载点击：走你的追踪链接（客户无需改 App）。</Typography>
            {version === 'v2' ? (
              <Typography variant="body2">- 事件：统一上报 `install_open` + `register`。</Typography>
            ) : (
              <Typography variant="body2">- 事件：上报 `install` + `first_open` + `register`。</Typography>
            )}
            <Typography variant="body2">- 每次上报都要有唯一 `event_uid`（SDK 已自动生成）。</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary">
        说明：本页教程按你当前系统接口（`/track/click` + `/api/sdk/events`）定制。
      </Typography>
    </Stack>
  );
}
