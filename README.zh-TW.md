# 程式碼審查機器人

> 使用 Gemini API 的程式碼審查機器人

翻譯版本：[English](./README.md) | [簡體中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md)

## 機器人使用方式

❗️⚠️ `由於成本考量，BOT 目前僅用於測試目的，並部署在有限制的 AWS Lambda 上。因此，不穩定的情況是完全正常的。建議自行部署 app。`

### 安裝

安裝：[apps/cr-gpt](https://github.com/apps/cr-gpt);

### 設定

1. 轉到你要整合此機器人的倉庫首頁
2. 點選 `settings`
3. 點選 `actions` 在下面的 `secrets and variables`
4. 使用託管機器人時，請將從 [Google AI Studio](https://aistudio.google.com/app/apikey) 取得的 API 金鑰新增為名為 `GEMINI_API_KEY` 的儲存庫變數。使用 GitHub Actions 時，請將其新增為同名密碼。
   <img width="1465" alt="image" src="https://user-images.githubusercontent.com/13167934/218533628-3974b70f-c423-44b0-b096-d1ec2ace85ea.png">

### 開始使用

1. 當你建立一個新的 Pull request 時，機器人會自動進行程式碼審查，審查訊息將顯示在 pr timeline / file changes 部分。
2. 在 `git push` 更新 Pull request 之後，cr bot 將重新審查更改的文件

範例：

[ChatGPT-CodeReview/pull/21](https://github.com/anc95/ChatGPT-CodeReview/pull/21)

<img width="1052" alt="image" src="https://user-images.githubusercontent.com/13167934/218999459-812206e1-d8d2-4900-8ce8-19b5b6e1f5cb.png">

## 使用 Github Actions

[actions/chatgpt-codereviewer](https://github.com/marketplace/actions/chatgpt-codereviewer)

1. 將 `GEMINI_API_KEY` 新增至 GitHub Actions secrets
2. 建立 `.github/workflows/cr.yml` 新增以下內容

```yml
name: Code Review

permissions:
  contents: read
  pull-requests: write

on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  test:
    # if: ${{ contains(github.event.*.labels.*.name, 'gpt review') }} # Optional; to run only when a label is attached
    runs-on: ubuntu-latest
    steps:
      - uses: anc95/ChatGPT-CodeReview@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          # Optional
          LANGUAGE: Chinese
          MODEL: gemini-2.5-flash # https://ai.google.dev/gemini-api/docs/models
          PROMPT: # example: Please check if there are any confusions or irregularities in the following code diff:
          top_p: 1
          temperature: 1
          max_tokens: 10000
          MAX_PATCH_LENGTH: 10000 # if the patch/diff length is large than MAX_PATCH_LENGTH, will be ignored and won't review. By default, with no MAX_PATCH_LENGTH set, there is also no limit for the patch/diff length.
          IGNORE_PATTERNS: /node_modules,*.md # Regex pattern to ignore files, separated by comma
```

## 自我託管

1. 複製程式碼
2. 複製 `.env.example` 到 `.env`, 並填寫環境變數
3. 安裝相依性並執行

```sh
npm i
npm i -g pm2
npm run build
pm2 start pm2.config.cjs
```

[probot](https://probot.github.io/docs/development/) 了解更多詳情

## 開發

### 設定

```sh
# Install dependencies
npm install

# Build code
npm run build

# Run the bot
npm run start
```

### Docker

```sh
# 1. Build container
docker build -t cr-bot .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> cr-bot
```

## 貢獻

如果您對如何改進 cr-bot 有建議，或者想報告錯誤，請開啟一個問題！我們喜歡所有的貢獻。

有關更多信息，請查看[貢獻指南](CONTRIBUTING.md).

## 靈感

這個項目的靈感來自[codereview.gpt](https://github.com/sturdy-dev/codereview.gpt)

## License

[ISC](LICENSE)© 2023 anc95
