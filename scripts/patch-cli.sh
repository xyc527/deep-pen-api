#!/bin/bash
# 修补 aiot-vue-cli，使其兼容 @vue/compiler-sfc 3.5（CLI 自带的是 Vue2 的 vue-template-compiler 调用）。
# 这几条 sed 与官方 CI 用的补丁一致；每条都幂等，目标文件不存在时跳过而不是硬失败。
set -e

CLI_DIR="$(dirname "$0")/../node_modules/aiot-vue-cli"

if [ ! -d "$CLI_DIR" ]; then
  echo "[patch-cli] 未找到 $CLI_DIR，跳过"
  exit 0
fi

patch_file() {
  local file="$1"; shift
  if [ ! -f "$file" ]; then
    echo "[patch-cli] 跳过不存在的文件: $file" >&2
    return 0
  fi
  sed -i "$@" "$file"
}

patch_file "$CLI_DIR/src/libs/rollup.config.js" \
  "s/commonjs(),/commonjs(),require('@rollup\/plugin-typescript')(),/g"
patch_file "$CLI_DIR/web-loaders/falcon-vue-loader/lib/parser.js" \
  "s/compiler.parseComponent(content, { pad: 'line' })/compiler.parse(content, { pad: 'line' }).descriptor/g"
patch_file "$CLI_DIR/cli-libs/index.js" \
  "s/path.resolve(__dirname, '.\/vue\/packages\/vue-template-compiler\/index.js')/'@vue\/compiler-sfc'/g"
patch_file "$CLI_DIR/src/libs/parser.js" \
  "s/compiler.parseComponent(content, { pad: true })/compiler.parse(content, { pad: true }).descriptor/g"
patch_file "$CLI_DIR/web-loaders/falcon-vue-loader/lib/template-compiler/index.js" \
  "s/compiler.compile/compiler.compileTemplate/g"
patch_file "$CLI_DIR/src/libs/rollup.config.js" \
  "s/const replaceValues = {}/const replaceValues = { 'defineComponent': '' }/g"

# falcon-ui 0.0.17 只带了 src/styles/{base,mixins,transition,vars}.less，没有 theme-default/theme.config.js，
# 于是每次构建都会打一条 "找不到theme" 的 WARNING。CLI 的 getThemeImportSource 里 theme 一旦为真就必然去找该文件
# （`theme || 'theme-default'` 让空字符串也绕不过去），所以直接补一个空主题配置最省事。
# 本应用所有样式都是自写全局 class + 行内 :style，不消费 FALCON_THEME 里的变量，空对象完全等价。
THEME_DIR="$CLI_DIR/../falcon-ui/src/styles/theme-default"
if [ -d "$(dirname "$THEME_DIR")" ] && [ ! -f "$THEME_DIR/theme.config.js" ]; then
  mkdir -p "$THEME_DIR"
  printf 'export default {}\n' > "$THEME_DIR/theme.config.js"
  echo "[patch-cli] 已补 falcon-ui 空主题配置（消除 theme 缺失警告）"
fi

echo "[patch-cli] 补丁应用完成"
