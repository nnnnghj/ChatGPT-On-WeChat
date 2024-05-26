FROM python:3

WORKDIR /app

# 设置 Python 和 Node.js 环境
ARG POETRY_VERSION=1.2.2

# 更新apt-get并安装基本工具
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 使用NodeSource安装Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 安装npm并修复依赖项
RUN apt-get update && \
    apt-get install -y npm && \
    apt-get install -y node-rimraf node-semver node-string-width node-strip-ansi node-tar node-validate-npm-package-name node-which node-cli-table3 node-columnify node-cssesc node-debug node-emoji-regex node-gyp node-http-proxy-agent node-https-proxy-agent node-mkdirp node-ms node-nopt node-normalize-package-data node-npm-bundled node-npm-normalize-package-bin node-npm-package-arg node-npmlog node-postcss-selector-parser node-read-package-json && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 安装Poetry
RUN pip install --no-cache-dir poetry==$POETRY_VERSION && \
    rm -rf ~/.cache/ && \
    echo "环境设置完成"

# 复制项目文件
COPY package*.json ./
COPY pyproject.toml ./
COPY poetry.lock ./

# 设置环境变量，避免下载无用的Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 安装依赖
RUN poetry install && \
    npm install && \
    npm install -g tsc-watch && \
    npm cache clean --force && \
    echo "依赖安装完成"

# 复制项目源代码
COPY . .

# 复制 CSV 文件到容器的 /data 目录
COPY ["./data/pred_lstm.csv", "/data/pred_lstm.csv"]
COPY ["./data/pred_gru.csv", "/data/pred_gru.csv"]
COPY ["./data/pred_saes.csv", "/data/pred_saes.csv"]

CMD ["npm", "run", "dev"]
