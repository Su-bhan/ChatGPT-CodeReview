# CodeReview BOT

> An AI-powered code review bot

Translation Versions: [ENGLISH](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md)

## Bot Usage

❗️⚠️ `Due to cost considerations, BOT is only used for testing purposes and is currently deployed on AWS Lambda with ratelimit restrictions. Therefore, unstable situations are completely normal. It is recommended to deploy an app by yourself.`

### Install

Install: [apps/cr-gpt](https://github.com/apps/cr-gpt);

### Configuration

1. Go to the repo homepage which you want integrate this bot
2. click `settings`
3. click `actions` under `secrets and variables`
4. For the hosted bot, create a repository variable named `GEMINI_API_KEY` with a key from [Google AI Studio](https://aistudio.google.com/app/apikey). For GitHub Actions, add the key as a `GEMINI_API_KEY` secret.
   <img width="1465" alt="image" src="https://user-images.githubusercontent.com/13167934/218533628-3974b70f-c423-44b0-b096-d1ec2ace85ea.png">

### Start using

1. The robot will automatically do the code review when you create a new Pull request, the review information will show in the pr timeline / file changes part.
2. After `git push` update the pull request, cr bot will re-review the changed files

example:

[ChatGPT-CodeReview/pull/21](https://github.com/anc95/ChatGPT-CodeReview/pull/21)

<img width="1052" alt="image" src="https://user-images.githubusercontent.com/13167934/218999459-812206e1-d8d2-4900-8ce8-19b5b6e1f5cb.png">

## Using Github Actions

[actions/chatgpt-codereviewer](https://github.com/marketplace/actions/chatgpt-codereviewer)

1. Add the `GEMINI_API_KEY` to your GitHub Actions secrets
2. create `.github/workflows/cr.yml` add bellow content

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
          MODEL: gemini-2.5-flash # https://ai.google.dev/gemini-api/docs/models

          # common
          LANGUAGE: Chinese
          PROMPT: # example: Please check if there are any confusions or irregularities in the following code diff:
          top_p: 1
          temperature: 1
          max_tokens: 10000
          MAX_PATCH_LENGTH: 10000 # if the patch/diff length is large than MAX_PATCH_LENGTH, will be ignored and won't review. By default, with no MAX_PATCH_LENGTH set, there is also no limit for the patch/diff length.
          IGNORE_PATTERNS: /node_modules/**/*,*.md # glob pattern or regex pattern to ignore files, separated by comma
          INCLUDE_PATTERNS: *.js,*.ts # glob pattern or regex pattern to include files, separated by comma
```

## Self-hosting

1. clone code
2. copy `.env.example` to `.env`, and fill the env variables
3. install deps and run

```sh
npm i
npm i -g pm2
npm run build
pm2 start pm2.config.cjs
```

[probot](https://probot.github.io/docs/development/) for more detail

## Kawnix provider

This repository also contains a separate Kawnix provider path. It does not
replace the existing GitHub webhook or GitHub Action workflows.

The provider exposes:

- `POST /api/kawnix/invoke` for Kawnix health, review-job creation, and status.
- `POST /api/kawnix/worker` for scheduled background execution.
- `POST /api/kawnix/maintenance` for scheduled retention cleanup.

Use [KAWNIX_DEPLOYMENT.md](./KAWNIX_DEPLOYMENT.md) for deployment, secret,
scheduler, GitHub App, and Kawnix registration instructions.

## Dev

### Setup

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

## Contributing

If you have suggestions for how cr-bot could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## Credit

this project is inpired by [codereview.gpt](https://github.com/sturdy-dev/codereview.gpt)

## License

[ISC](LICENSE) © 2023 anc95
