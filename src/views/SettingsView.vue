<template>
  <v-container fluid class="pa-0" style="max-width:1100px">
    <!-- 页面标题 -->
    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-4">
      <h2 class="text-h5 font-weight-bold d-flex align-center ga-2">
        <v-icon :icon="mdiCogOutline" size="28" />
        {{ t('settings.title') }}
      </h2>
      <div class="d-flex align-center ga-2">
        <v-btn variant="text" icon size="small" :loading="loading" @click="load(true)">
          <v-icon :icon="mdiRefresh" />
        </v-btn>
        <v-btn color="primary" :loading="saving" @click="save">
          {{ saving ? t('settings.saving') : t('settings.save') }}
        </v-btn>
      </div>
    </div>

    <!-- 加载指示器 -->
    <div v-if="loading" class="d-flex justify-center align-center mt-16">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <template v-else>
      <!-- Snackbar 通知 -->
      <v-snackbar v-model="saved" color="success" timeout="3000" location="top end" variant="tonal">
        <v-icon :icon="mdiCheckCircleOutline" class="mr-2" />
        {{ t('settings.saved') }}
      </v-snackbar>
      <v-snackbar v-model="showSaveErr" color="error" timeout="5000" location="top end" variant="tonal">
        <v-icon :icon="mdiAlertCircleOutline" class="mr-2" />
        {{ saveErr }}
      </v-snackbar>

      <!-- 桌面端布局：侧边栏 + 主内容 -->
      <v-row no-gutters class="settings-layout">
        <!-- 侧边栏导航 - 桌面端 -->
        <v-col v-if="!isMobile" cols="12" md="3" lg="2">
          <v-card class="pa-2" :style="{ position: 'sticky', top: '16px' }">
            <v-list nav density="compact" rounded="lg">
              <v-list-item
                v-for="item in settingsNavItems"
                :key="item.key"
                :active="activeSection === item.key"
                active-color="primary"
                @click="activeSection = item.key"
              >
                <template #prepend>
                  <v-icon :icon="item.icon" size="20" class="mr-2" />
                </template>
                <v-list-item-title class="text-body-2">{{ item.label }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>

        <!-- 移动端：水平 chips 导航 -->
        <v-col v-if="isMobile" cols="12" class="mb-4">
          <div class="d-flex ga-2 flex-wrap">
            <v-chip
              v-for="item in settingsNavItems"
              :key="item.key"
              :color="activeSection === item.key ? 'primary' : undefined"
              :variant="activeSection === item.key ? 'flat' : 'outlined'"
              size="small"
              @click="activeSection = item.key"
            >
              <v-icon :icon="item.icon" size="16" start />
              {{ item.label }}
            </v-chip>
          </div>
        </v-col>

        <!-- 主内容区 -->
        <v-col cols="12" :md="isMobile ? 12 : 9" :lg="isMobile ? 12 : 10">
          <div class="d-flex flex-column ga-4">

            <!-- ========== Bot 设置 ========== -->
            <v-card v-show="activeSection === 'bot'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('bot')">
                <v-icon :icon="mdiRobot" size="22" />
                {{ t('settings.section.bot') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('bot') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('bot')">
                  <!-- Bot Token -->
                  <v-text-field
                    v-model="form.BOT_TOKEN"
                    :label="t('settings.config.botToken')"
                    :placeholder="t('settings.token.placeholder')"
                    type="password"
                    autocomplete="off"
                    :append-inner-icon="mdiTestTube"
                    :loading="testingTok"
                    @click:append-inner="testToken"
                    class="mb-2"
                  />
                  <div v-if="tokResult" class="mb-3">
                    <v-alert
                      :type="tokResult.ok ? 'success' : 'error'"
                      variant="tonal"
                      density="compact"
                    >
                      {{ tokResult.ok ? t('settings.token.valid', { username: tokResult.bot.username, id: tokResult.bot.id }) : tokResult.err }}
                    </v-alert>
                  </div>

                  <!-- Topic Group ID -->
                  <v-text-field
                    v-model="form.FORUM_GROUP_ID"
                    :label="t('settings.topicGroupId')"
                    :placeholder="t('settings.topicGroupPh')"
                    :append-inner-icon="mdiWebhook"
                    :loading="resolvingGroup"
                    @click:append-inner="resolveChat(form.FORUM_GROUP_ID, 'group')"
                  />
                  <v-card v-if="groupInfo" variant="tonal" class="mb-3 pa-3 d-flex align-center ga-3 flex-wrap">
                    <v-avatar color="primary" size="38" rounded="circle">
                      <v-icon :icon="mdiAccountGroupOutline" size="20" />
                    </v-avatar>
                    <div class="flex-grow-1" style="min-width:0">
                      <div class="text-body-2 font-weight-bold">{{ groupInfo.title }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('common.id') }}: {{ groupInfo.id }}</div>
                    </div>
                    <v-btn size="small" color="primary" variant="tonal" @click="form.FORUM_GROUP_ID = String(groupInfo.id)">
                      {{ t('settings.use') }}
                    </v-btn>
                  </v-card>
                  <div v-if="groupErr" class="mb-3">
                    <v-alert type="error" variant="tonal" density="compact">{{ groupErr }}</v-alert>
                  </div>

                  <v-divider class="my-4" />

                  <!-- 查询聊天 -->
                  <v-text-field
                    v-model="chatQuery"
                    :label="t('settings.queryChat')"
                    :placeholder="t('settings.queryPh')"
                    :append-inner-icon="mdiWebhook"
                    :loading="resolvingCustom"
                    @click:append-inner="resolveChat(chatQuery, 'custom')"
                  />
                  <v-card v-if="customInfo" variant="tonal" class="mb-3 pa-3 d-flex align-center ga-3 flex-wrap">
                    <v-avatar color="secondary" size="38" rounded="circle">
                      <v-icon :icon="mdiAccountGroupOutline" size="20" />
                    </v-avatar>
                    <div class="flex-grow-1" style="min-width:0">
                      <div class="text-body-2 font-weight-bold">{{ customInfo.title || customInfo.first_name }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('common.id') }}: {{ customInfo.id }}</div>
                    </div>
                    <v-btn size="small" variant="tonal" @click="form.FORUM_GROUP_ID = String(customInfo.id)">
                      {{ t('settings.useId') }}
                    </v-btn>
                    <v-btn size="small" variant="tonal" @click="addAdmin(String(customInfo.id))">
                      {{ t('settings.setAdmin') }}
                    </v-btn>
                  </v-card>

                  <v-divider class="my-4" />

                  <!-- 管理员 ID -->
                  <div class="text-body-2 font-weight-medium mb-2">{{ t('settings.adminIds') }}</div>

                  <v-row v-if="adminList.length" dense class="mb-3">
                    <v-col v-for="(id, i) in adminList" :key="id" cols="12" sm="6">
                      <v-card variant="tonal" class="pa-3 d-flex align-center ga-3" style="position:relative">
                        <v-avatar color="primary" size="42" rounded="circle">
                          <v-img v-if="!adminAvatarErrors[id]" :src="`/api/users/${id}/avatar`" cover @error="markAdminAvatarError(id)" />
                          <span v-else class="text-body-2 font-weight-bold">{{ adminInitial(id) }}</span>
                        </v-avatar>
                        <div class="flex-grow-1" style="min-width:0">
                          <div class="text-body-2 font-weight-medium text-truncate">{{ adminDisplayName(id) }}</div>
                          <div class="text-caption text-medium-emphasis">
                            {{ adminSecondaryLine(id) }} &middot; {{ t('common.id') }}: {{ id }}
                          </div>
                        </div>
                        <v-btn icon variant="text" size="x-small" color="error" @click="removeAdmin(i)" style="position:absolute;top:8px;right:8px">
                          <v-icon :icon="mdiCloseCircleOutline" size="18" />
                        </v-btn>
                      </v-card>
                    </v-col>
                  </v-row>

                  <div class="d-flex align-center ga-2 mb-2">
                    <div class="flex-grow-1">
                      <UserSearchPicker v-model="newAdminId" @selected="u => newAdminId = String(u.user_id)" />
                    </div>
                    <v-btn size="small" variant="tonal" @click="addAdmin(newAdminId)">
                      <v-icon :icon="mdiPlus" size="16" start />
                      {{ t('settings.add') }}
                    </v-btn>
                  </div>
                  <div class="text-caption text-medium-emphasis">{{ t('settings.adminHint') }}</div>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== Webhook 设置 ========== -->
            <v-card v-show="activeSection === 'webhook'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('webhook')">
                <v-icon :icon="mdiLinkVariant" size="22" />
                {{ t('settings.section.webhook') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('webhook') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('webhook')">
                  <v-text-field
                    v-model="webhookUrl"
                    :label="t('settings.webhookUrl')"
                    :placeholder="t('settings.webhook.placeholder')"
                    class="mb-2"
                  />
                  <div class="d-flex align-center ga-2 mb-3">
                    <v-btn color="primary" size="small" :loading="settingWh" @click="setWebhook">
                      {{ t('settings.webhookSet') }}
                    </v-btn>
                  </div>
                  <v-alert v-if="whResult" :type="whResult.ok ? 'success' : 'error'" variant="tonal" density="compact" class="mb-2">
                    {{ whResult.ok ? whResult.message : whResult.err }}
                  </v-alert>
                  <div class="text-caption text-medium-emphasis">{{ t('settings.webhookHint') }}</div>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== 验证设置 ========== -->
            <v-card v-show="activeSection === 'verify'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('verify')">
                <v-icon :icon="mdiShieldCheckOutline" size="22" />
                {{ t('settings.section.verify') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('verify') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('verify')">
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.verifyEnable') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.verifyEnableHint') }}</div>
                    </div>
                    <v-switch v-model="verifyEnabled" color="primary" hide-details inset />
                  </div>

                  <template v-if="verifyEnabled">
                    <v-divider class="my-4" />
                    <v-select
                      v-model="form.CAPTCHA_TYPE"
                      :items="captchaTypeItems"
                      item-title="label"
                      item-value="value"
                      :label="t('settings.verifyType')"
                      class="mb-2"
                    />
                    <v-text-field
                      v-model="form.CAPTCHA_SITE_URL"
                      :label="t('settings.verify.siteUrl')"
                      :placeholder="t('settings.verify.siteUrlPh')"
                      class="mb-1"
                    />
                    <div class="text-caption text-medium-emphasis mb-3">{{ t('settings.verify.siteUrlHint') }}</div>

                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="text-body-2 font-weight-medium">{{ t('settings.verify.timeout') }}</div>
                      <v-text-field
                        v-model.number="form.VERIFICATION_TIMEOUT"
                        type="number"
                        min="60"
                        max="3600"
                        density="compact"
                        variant="outlined"
                        hide-details
                        style="max-width:120px"
                        @change="clampTimeout"
                      />
                    </div>

                    <div class="d-flex align-center justify-space-between mb-2">
                      <div class="text-body-2 font-weight-medium">{{ t('settings.verify.maxAttempts') }}</div>
                      <v-text-field
                        v-model="form.MAX_VERIFICATION_ATTEMPTS"
                        type="number"
                        min="1"
                        max="10"
                        density="compact"
                        variant="outlined"
                        hide-details
                        style="max-width:120px"
                      />
                    </div>
                  </template>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== 功能开关 ========== -->
            <v-card v-show="activeSection === 'feature'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('feature')">
                <v-icon :icon="mdiCogOutline" size="22" />
                {{ t('settings.section.feature') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('feature') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('feature')">
                  <!-- 自动解除封锁 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.autoUnblock') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.autoUnblockHint') }}</div>
                    </div>
                    <v-switch v-model="autoUnblock" color="primary" hide-details inset />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 白名单 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.whitelist') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.whitelistHint') }}</div>
                    </div>
                    <v-switch v-model="whitelistEnabled" color="primary" hide-details inset />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 命令过滤 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.cmdFilter') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.cmdFilterHint') }}</div>
                    </div>
                    <v-switch v-model="cmdFilter" color="primary" hide-details inset />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 管理员通知 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.adminNotify') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.adminNotifyHint') }}</div>
                    </div>
                    <v-switch v-model="adminNotifyEnabled" color="primary" hide-details inset />
                  </div>
                  <v-divider class="my-3" />

                  <!-- Zalgo 过滤 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.zalgoFilter') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.zalgoFilterHint') }}</div>
                    </div>
                    <v-switch v-model="zalgoFilterEnabled" color="primary" hide-details inset />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 每分钟最大消息数 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div class="text-body-2 font-weight-medium">{{ t('settings.feature.maxPerMin') }}</div>
                    <v-text-field
                      v-model="form.MAX_MESSAGES_PER_MINUTE"
                      type="number"
                      min="1"
                      max="300"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width:120px"
                    />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 登录会话 TTL -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.loginSessionTtl') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.loginSessionTtlHint') }}</div>
                    </div>
                    <v-text-field
                      v-model.number="form.LOGIN_SESSION_TTL"
                      type="number"
                      min="300"
                      max="2592000"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width:140px"
                      @change="clampLoginSessionTtl"
                    />
                  </div>
                  <v-divider class="my-3" />

                  <!-- 内联键盘删除开关 -->
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div>
                      <div class="text-body-2 font-weight-medium">{{ t('settings.feature.inlineKbDeleteEnable') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.feature.inlineKbDeleteEnableHint') }}</div>
                    </div>
                    <v-switch v-model="inlineKbDeleteEnabled" color="primary" hide-details inset />
                  </div>

                  <template v-if="inlineKbDeleteEnabled">
                    <v-divider class="my-3" />
                    <div class="d-flex align-center justify-space-between mb-2">
                      <div>
                        <div class="text-body-2 font-weight-medium">{{ t('settings.feature.inlineKbDelete') }}</div>
                        <div class="text-caption text-medium-emphasis">{{ t('settings.feature.inlineKbDeleteHint') }}</div>
                      </div>
                      <v-text-field
                        v-model.number="form.INLINE_KB_MSG_DELETE_SECONDS"
                        type="number"
                        min="0"
                        max="600"
                        density="compact"
                        variant="outlined"
                        hide-details
                        style="max-width:120px"
                        @change="clampInlineKbDelete"
                      />
                    </div>
                  </template>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== 消息过滤 ========== -->
            <v-card v-show="activeSection === 'messageFilter'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('messageFilter')">
                <v-icon :icon="mdiFilterOutline" size="22" />
                {{ t('settings.section.messageFilter') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('messageFilter') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('messageFilter')">
                  <div class="text-caption text-medium-emphasis mb-3">{{ t('settings.feature.messageFilterHint') }}</div>

                  <!-- 规则类型指南 -->
                  <v-card variant="tonal" class="mb-4">
                    <v-list density="compact" lines="two">
                      <v-list-item>
                        <template #prepend><v-chip color="primary" size="small" variant="flat" class="mr-3">text</v-chip></template>
                        <v-list-item-title class="text-body-2">{{ t('settings.feature.messageFilterTextHelp') }}</v-list-item-title>
                        <v-list-item-subtitle><code class="text-caption">{{ t('settings.feature.messageFilterTextExample') }}</code></v-list-item-subtitle>
                      </v-list-item>
                      <v-divider inset />
                      <v-list-item>
                        <template #prepend><v-chip color="secondary" size="small" variant="flat" class="mr-3">regex</v-chip></template>
                        <v-list-item-title class="text-body-2">{{ t('settings.feature.messageFilterRegexHelp') }}</v-list-item-title>
                        <v-list-item-subtitle><code class="text-caption">{{ t('settings.feature.messageFilterRegexExample') }}</code></v-list-item-subtitle>
                      </v-list-item>
                      <v-divider inset />
                      <v-list-item>
                        <template #prepend><v-chip color="info" size="small" variant="flat" class="mr-3">json</v-chip></template>
                        <v-list-item-title class="text-body-2">{{ t('settings.feature.messageFilterJsonHelp') }}</v-list-item-title>
                        <v-list-item-subtitle><code class="text-caption">{{ t('settings.feature.messageFilterJsonExample') }}</code></v-list-item-subtitle>
                      </v-list-item>
                    </v-list>
                  </v-card>

                  <v-divider class="mb-4" />

                  <!-- 添加规则表单 -->
                  <v-select
                    v-model="messageFilterType"
                    :items="messageFilterTypeItems"
                    item-title="label"
                    item-value="value"
                    :label="t('settings.feature.messageFilterType')"
                    class="mb-2"
                  />
                  <v-textarea
                    v-model="messageFilterValue"
                    :label="t('settings.feature.messageFilterValue')"
                    :placeholder="t('settings.feature.messageFilterValuePlaceholder')"
                    rows="4"
                    auto-grow
                    class="mb-2"
                    style="font-family:monospace"
                  />
                  <div class="d-flex justify-end mb-2">
                    <v-btn color="primary" size="small" @click="addMessageFilterRule">
                      <v-icon :icon="mdiPlus" size="16" start />
                      {{ t('settings.feature.messageFilterAdd') }}
                    </v-btn>
                  </div>
                  <v-alert v-if="messageFilterErr" type="error" variant="tonal" density="compact" class="mb-3">
                    {{ messageFilterErr }}
                  </v-alert>

                  <v-divider class="mb-4" />

                  <!-- 规则列表 -->
                  <div v-if="messageFilterRules.length" class="d-flex flex-column ga-3">
                    <v-card v-for="rule in messageFilterRules" :key="rule.id" variant="tonal" class="pa-3">
                      <div class="d-flex align-center justify-space-between ga-2 mb-2">
                        <div class="d-flex align-center ga-2 flex-wrap">
                          <v-chip color="primary" size="small" variant="flat">{{ formatRuleType(rule.type) }}</v-chip>
                          <code class="text-caption text-medium-emphasis">{{ t('settings.feature.messageFilterRuleId') }}: {{ rule.id }}</code>
                        </div>
                        <v-btn icon variant="text" size="x-small" color="error" :title="t('settings.feature.messageFilterRemove')" @click="removeMessageFilterRule(rule.id)">
                          <v-icon :icon="mdiCloseCircleOutline" size="18" />
                        </v-btn>
                      </div>
                      <pre class="text-caption pa-2 rounded-lg" style="white-space:pre-wrap;word-break:break-word;font-family:monospace;background:rgba(0,0,0,0.15)"><code>{{ rule.value }}</code></pre>
                    </v-card>
                  </div>
                  <v-alert v-else type="info" variant="tonal" density="compact">
                    {{ t('settings.feature.messageFilterEmpty') }}
                  </v-alert>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== 欢迎消息 ========== -->
            <v-card v-show="activeSection === 'welcome'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('welcome')">
                <v-icon :icon="mdiEmoticonHappyOutline" size="22" />
                {{ t('settings.section.welcome') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('welcome') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('welcome')">
                  <div class="d-flex align-center justify-space-between mb-2">
                    <div class="text-body-2 font-weight-medium">{{ t('settings.welcome.enable') }}</div>
                    <v-switch v-model="welcomeEnabled" color="primary" hide-details inset />
                  </div>
                  <v-textarea
                    v-if="welcomeEnabled"
                    v-model="form.WELCOME_MESSAGE"
                    :label="t('settings.welcome.content')"
                    rows="5"
                    auto-grow
                    class="mt-2"
                    style="font-family:monospace"
                  />
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- ========== 存储管理 ========== -->
            <v-card v-show="activeSection === 'storage'">
              <v-card-title class="d-flex align-center ga-2 text-subtitle-1 font-weight-bold" style="cursor:pointer" @click="toggleSection('storage')">
                <v-icon :icon="mdiDatabaseOutline" size="22" />
                {{ t('settings.section.storage') }}
                <v-spacer />
                <v-icon :icon="isSectionOpen('storage') ? mdiMinus : mdiPlus" size="20" />
              </v-card-title>
              <v-expand-transition>
                <v-card-text v-show="isSectionOpen('storage')">
                  <!-- 数据库状态 -->
                  <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-3">
                    <div>
                      <div class="text-body-2 font-weight-medium">
                        {{ t('settings.storage.current') }}
                        <v-chip
                          :color="dbInfo.active === 'hyperdrive' ? 'info' : (dbInfo.active === 'd1' ? 'success' : 'warning')"
                          size="small"
                          variant="tonal"
                          class="ml-1"
                        >
                          {{ currentDbLabel }}
                        </v-chip>
                      </div>
                      <div v-if="!dbInfo.hasD1 && !dbInfo.hasHyperdrive" class="text-caption text-medium-emphasis mt-1">
                        {{ t('settings.storage.noD1') }}
                      </div>
                      <div v-if="dbInfo.hasHyperdrive && dbInfo.active !== 'hyperdrive'" class="text-caption text-medium-emphasis mt-1">
                        {{ t('settings.storage.hyperdriveHint') }}
                      </div>
                    </div>
                  </div>

                  <!-- 数据库切换按钮组 -->
                  <v-btn-toggle
                    v-if="dbInfo.hasD1 || dbInfo.hasHyperdrive"
                    v-model="dbInfo.active"
                    mandatory
                    color="primary"
                    variant="outlined"
                    density="comfortable"
                    class="mb-3"
                  >
                    <v-btn value="kv" size="small" :disabled="dbSwitching" @click="switchDb('kv', true)">
                      {{ t('settings.storage.kvShort') }}
                    </v-btn>
                    <v-btn v-if="dbInfo.hasD1" value="d1" size="small" :disabled="dbSwitching" @click="switchDb('d1', true)">
                      {{ t('settings.storage.d1Short') }}
                    </v-btn>
                    <v-btn v-if="dbInfo.hasHyperdrive" value="hyperdrive" size="small" :disabled="dbSwitching" @click="switchDb('hyperdrive', true)">
                      {{ t('settings.storage.hyperdriveShort') }}
                    </v-btn>
                  </v-btn-toggle>

                  <div v-if="dbSwitching" class="d-flex align-center ga-2 mb-2">
                    <v-progress-circular indeterminate size="20" width="2" color="primary" />
                    <span class="text-caption text-medium-emphasis">{{ t('settings.storage.syncing') }}</span>
                  </div>
                  <v-alert v-if="dbMsg" :type="dbOk ? 'success' : 'error'" variant="tonal" density="compact" class="mb-2">
                    {{ dbMsg }}
                  </v-alert>
                  <div class="text-caption text-medium-emphasis mb-3">{{ t('settings.storage.switchHint') }}</div>

                  <v-divider class="my-4" />

                  <!-- SQL 工具 -->
                  <div class="text-body-2 font-weight-medium mb-1">{{ t('settings.storage.sqlTools') }}</div>
                  <div class="text-caption text-medium-emphasis mb-3">{{ t('settings.storage.sqlHint') }}</div>

                  <div class="d-flex align-center ga-2 flex-wrap mb-3">
                    <v-select
                      v-model="sqlExportMode"
                      :items="sqlExportModeItems"
                      item-title="label"
                      item-value="value"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width:180px"
                    />
                    <v-text-field
                      v-if="sqlExportMode === 'aes'"
                      v-model="sqlExportPassword"
                      type="password"
                      :placeholder="t('settings.storage.sqlAesPassword')"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width:220px"
                    />
                  </div>

                  <div class="d-flex align-center ga-2 flex-wrap mb-3">
                    <v-btn variant="tonal" size="small" :loading="sqlExporting" :disabled="sqlBusy" @click="exportSql">
                      <v-icon :icon="mdiExportVariant" size="16" start />
                      {{ t('settings.storage.sqlExport') }}
                    </v-btn>
                    <v-btn color="primary" size="small" :loading="sqlImporting" :disabled="sqlBusy" @click="pickSqlFile">
                      <v-icon :icon="mdiImportVariant" size="16" start />
                      {{ t('settings.storage.sqlImport') }}
                    </v-btn>
                    <input
                      ref="sqlFileInput"
                      type="file"
                      accept=".sql,text/sql"
                      style="display:none"
                      @change="handleSqlFileChange"
                    />
                  </div>

                  <v-text-field
                    v-model="sqlImportPassword"
                    type="password"
                    :placeholder="t('settings.storage.sqlAesPasswordImport')"
                    density="compact"
                    variant="outlined"
                    hide-details
                    class="mb-2"
                    style="max-width:300px"
                  />

                  <div v-if="sqlFileName" class="text-caption text-medium-emphasis mb-2">
                    <code>{{ sqlFileName }}</code>
                  </div>
                  <v-alert v-if="sqlMsg" :type="sqlOk ? 'success' : 'error'" variant="tonal" density="compact" class="mb-2">
                    {{ sqlMsg }}
                  </v-alert>

                  <v-divider class="my-4" />

                  <!-- 危险区域 -->
                  <div class="d-flex align-center justify-space-between flex-wrap ga-3">
                    <div>
                      <div class="text-body-2 font-weight-medium text-error">{{ t('settings.storage.clearData') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ t('settings.storage.clearDataHint') }}</div>
                    </div>
                    <v-btn color="error" size="small" variant="tonal" :loading="clearingData" @click="showClearDataDialog = true">
                      <v-icon :icon="mdiDeleteOutline" size="16" start />
                      {{ t('settings.storage.clearData') }}
                    </v-btn>
                  </div>

                  <!-- 清除数据确认对话框 -->
                  <v-dialog v-model="showClearDataDialog" max-width="440">
                    <v-card>
                      <v-card-title class="text-h6 d-flex align-center ga-2">
                        <v-icon :icon="mdiDeleteOutline" color="error" />
                        {{ t('settings.storage.clearData') }}
                      </v-card-title>
                      <v-card-text>
                        {{ t('settings.storage.clearDataConfirm') }}
                      </v-card-text>
                      <v-card-actions>
                        <v-spacer />
                        <v-btn variant="text" @click="showClearDataDialog = false">{{ t('common.cancel') || 'Cancel' }}</v-btn>
                        <v-btn color="error" variant="flat" :loading="clearingData" @click="clearData">
                          {{ t('settings.storage.clearData') }}
                        </v-btn>
                      </v-card-actions>
                    </v-card>
                  </v-dialog>
                </v-card-text>
              </v-expand-transition>
            </v-card>

            <!-- 保存按钮（底部） -->
            <div class="d-flex justify-end mt-2">
              <v-btn color="primary" size="large" :loading="saving" @click="save">
                <v-icon :icon="mdiContentSaveOutline" start />
                {{ saving ? t('settings.saving') : t('settings.saveAll') }}
              </v-btn>
            </div>

          </div>
        </v-col>
      </v-row>
    </template>

    <!-- SQL 导入确认对话框 -->
    <v-dialog v-model="showSqlImportDialog" max-width="440">
      <v-card>
        <v-card-title class="text-h6 d-flex align-center ga-2">
          <v-icon :icon="mdiImportVariant" color="warning" />
          {{ t('settings.storage.sqlImport') }}
        </v-card-title>
        <v-card-text>
          {{ t('settings.storage.sqlImportConfirm') }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelSqlImport">{{ t('common.cancel') || 'Cancel' }}</v-btn>
          <v-btn color="warning" variant="flat" @click="confirmSqlImport">{{ t('settings.storage.sqlImport') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import api from '../stores/api.js'
import UserSearchPicker from '../components/UserSearchPicker.vue'
import { useI18nStore } from '../stores/i18n'
import { useAuthStore } from '../stores/auth.js'
import { readLocalCache, writeLocalCache } from '../stores/local-cache.js'
import {
  MESSAGE_FILTER_RULE_TYPES,
  normalizeMessageFilterRule,
  parseMessageFilterRules,
  serializeMessageFilterRules,
} from '../../shared/message-filters.js'

import {
  mdiRobot,
  mdiLinkVariant,
  mdiLockOutline,
  mdiCogOutline,
  mdiFilterOutline,
  mdiEmoticonHappyOutline,
  mdiDatabaseOutline,
  mdiRefresh,
  mdiContentSaveOutline,
  mdiCheckCircleOutline,
  mdiAlertCircleOutline,
  mdiDeleteOutline,
  mdiPlus,
  mdiMinus,
  mdiTestTube,
  mdiWebhook,
  mdiShieldCheckOutline,
  mdiAccountGroupOutline,
  mdiBellOutline,
  mdiTimerOutline,
  mdiNumeric,
  mdiImageOutline,
  mdiTextBoxOutline,
  mdiKeyVariant,
  mdiExportVariant,
  mdiImport,
  mdiCloseCircleOutline,
} from '@mdi/js'

const i18n = useI18nStore()
const auth = useAuthStore()
const router = useRouter()
const t = i18n.t
const { mobile: isMobile } = useDisplay()

const form = ref({})
const activeSection = ref('bot')
const loading = ref(true), saving = ref(false), saved = ref(false), saveErr = ref('')
const showSaveErr = ref(false)
const testingTok = ref(false), tokResult = ref(null)
const webhookUrl = ref(''), settingWh = ref(false), whResult = ref(null)
const chatQuery = ref(''), resolvingCustom = ref(false), customInfo = ref(null)
const resolvingGroup = ref(false), groupInfo = ref(null), groupErr = ref('')
const newAdminId = ref('')
const adminProfiles = ref({})
const adminAvatarErrors = ref({})
const dbInfo = ref({ active: 'kv', hasD1: false, hasHyperdrive: false }), dbSwitching = ref(false), dbMsg = ref(''), dbOk = ref(true)
const clearingData = ref(false)
const sqlExporting = ref(false), sqlImporting = ref(false), sqlMsg = ref(''), sqlOk = ref(true), sqlFileName = ref('')
const sqlFileInput = ref(null)
const sqlExportMode = ref('base64')
const sqlExportPassword = ref('')
const sqlImportPassword = ref('')
const messageFilterType = ref('text')
const messageFilterValue = ref('')
const messageFilterErr = ref('')
const showClearDataDialog = ref(false)
const showSqlImportDialog = ref(false)
const pendingSqlEvent = ref(null)
const sectionState = ref({
  bot: true,
  webhook: true,
  verify: true,
  feature: true,
  messageFilter: true,
  welcome: true,
  storage: true,
})

const SETTINGS_CACHE_KEY = 'settings:form'
const SETTINGS_DB_CACHE_KEY = 'settings:db-info'

let adminProfileSeq = 0

function syncSettingsCache() {
  writeLocalCache(SETTINGS_CACHE_KEY, {
    ...form.value,
    WEBHOOK_URL: webhookUrl.value || '',
  })
}

function isSectionOpen(key) {
  return sectionState.value[key] !== false
}

function toggleSection(key) {
  sectionState.value = {
    ...sectionState.value,
    [key]: !isSectionOpen(key),
  }
}

const settingsNavItems = computed(() => [
  { key: 'bot', icon: mdiRobot, label: t('settings.section.bot') },
  { key: 'webhook', icon: mdiLinkVariant, label: t('settings.section.webhook') },
  { key: 'verify', icon: mdiShieldCheckOutline, label: t('settings.section.verify') },
  { key: 'feature', icon: mdiCogOutline, label: t('settings.section.feature') },
  { key: 'messageFilter', icon: mdiFilterOutline, label: t('settings.section.messageFilter') },
  { key: 'welcome', icon: mdiEmoticonHappyOutline, label: t('settings.section.welcome') },
  { key: 'storage', icon: mdiDatabaseOutline, label: t('settings.section.storage') },
])

const sqlBusy = computed(() => sqlExporting.value || sqlImporting.value)

const currentDbLabel = computed(() => {
  const a = dbInfo.value.active
  if (a === 'hyperdrive') return t('settings.storage.currentHyperdrive')
  if (a === 'd1') return t('settings.storage.currentD1')
  return t('settings.storage.currentKv')
})

const captchaTypeItems = computed(() => [
  { value: 'math', label: t('settings.verify.math') },
  { value: 'image_numeric', label: t('settings.verify.imgNum') },
  { value: 'image_alphanumeric', label: t('settings.verify.imgAlpha') },
])

const sqlExportModeItems = [
  { value: 'plain', label: 'Plain' },
  { value: 'base64', label: 'Base64' },
  { value: 'aes', label: 'AES-256-GCM' },
]

const messageFilterTypeItems = computed(() =>
  MESSAGE_FILTER_RULE_TYPES.map(type => ({ value: type, label: formatRuleType(type) }))
)

const boolProp = key => computed({ get: () => form.value[key] === 'true', set: v => { form.value[key] = v ? 'true' : 'false' } })
const verifyEnabled = boolProp('VERIFICATION_ENABLED')
const autoUnblock = boolProp('AUTO_UNBLOCK_ENABLED')
const whitelistEnabled = boolProp('WHITELIST_ENABLED')
const cmdFilter = boolProp('BOT_COMMAND_FILTER')
const adminNotifyEnabled = boolProp('ADMIN_NOTIFY_ENABLED')
const zalgoFilterEnabled = boolProp('ZALGO_FILTER_ENABLED')
const inlineKbDeleteEnabled = boolProp('INLINE_KB_MSG_DELETE_ENABLED')
const welcomeEnabled = boolProp('WELCOME_ENABLED')

const adminList = computed({
  get: () => (form.value.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  set: arr => { form.value.ADMIN_IDS = arr.join(',') },
})

const messageFilterTypes = MESSAGE_FILTER_RULE_TYPES
const messageFilterRules = computed({
  get: () => parseMessageFilterRules(form.value.MESSAGE_FILTER_RULES),
  set: (rules) => {
    form.value.MESSAGE_FILTER_RULES = serializeMessageFilterRules(rules)
  },
})

function formatRuleType(type) {
  return {
    text: t('bot.filter.type.text'),
    regex: t('bot.filter.type.regex'),
    json: t('bot.filter.type.json'),
  }[type] || type
}

function addAdmin(id) { const v = String(id).trim(); if (v && !adminList.value.includes(v)) adminList.value = [...adminList.value, v]; newAdminId.value = '' }
function removeAdmin(i) { const a = [...adminList.value]; a.splice(i, 1); adminList.value = a }

function getAdminProfile(id) {
  return adminProfiles.value[String(id)] || { user_id: String(id), first_name: '', last_name: '', username: '' }
}

function adminDisplayName(id) {
  const profile = getAdminProfile(id)
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return fullName || (profile.username ? `@${profile.username}` : `ID ${id}`)
}

function adminSecondaryLine(id) {
  const profile = getAdminProfile(id)
  return profile.username ? `@${profile.username}` : t('users.detail.noUsername')
}

function adminInitial(id) {
  const profile = getAdminProfile(id)
  const seed = String(profile.first_name || profile.username || id || '?').replace(/^@/, '')
  return seed ? seed[0].toUpperCase() : '?'
}

function markAdminAvatarError(id) {
  adminAvatarErrors.value = { ...adminAvatarErrors.value, [String(id)]: true }
}

function resetMessageFilterDraft() {
  messageFilterType.value = 'text'
  messageFilterValue.value = ''
  messageFilterErr.value = ''
}

function addMessageFilterRule() {
  messageFilterErr.value = ''
  try {
    const nextRule = normalizeMessageFilterRule({
      type: messageFilterType.value,
      value: messageFilterValue.value,
    })
    messageFilterRules.value = [...messageFilterRules.value, nextRule]
    resetMessageFilterDraft()
  } catch (e) {
    messageFilterErr.value = e?.message || t('settings.feature.messageFilterInvalidFallback')
  }
}

function removeMessageFilterRule(ruleId) {
  messageFilterRules.value = messageFilterRules.value.filter(rule => rule.id !== ruleId)
}

async function resolveAdminProfiles() {
  const ids = adminList.value.map((id) => String(id))
  const currentSeq = ++adminProfileSeq

  if (!ids.length) {
    adminProfiles.value = {}
    adminAvatarErrors.value = {}
    return
  }

  const nextProfiles = {}

  await Promise.all(ids.map(async (id) => {
    try {
      const matches = await api.get(`/api/users/search?q=${encodeURIComponent(id)}`)
      const exact = Array.isArray(matches) ? matches.find((item) => String(item.user_id) === id) : null
      if (exact) {
        nextProfiles[id] = exact
        return
      }
    } catch {}

    try {
      const result = await api.post('/api/tg/resolve-chat', { chatId: id })
      const chat = result?.chat
      if (chat) {
        nextProfiles[id] = {
          user_id: String(chat.id || id),
          first_name: chat.first_name || chat.title || '',
          last_name: chat.last_name || '',
          username: chat.username || '',
        }
        return
      }
    } catch {}

    nextProfiles[id] = { user_id: id, first_name: '', last_name: '', username: '' }
  }))

  if (currentSeq !== adminProfileSeq) return

  adminProfiles.value = nextProfiles
  adminAvatarErrors.value = ids.reduce((acc, id) => {
    acc[id] = false
    return acc
  }, {})
}

async function load(force = false) {
  loading.value = true

  const cachedSettings = !force ? readLocalCache(SETTINGS_CACHE_KEY, { ttlMs: 5 * 60 * 1000 }) : null
  const cachedDbInfo = !force ? readLocalCache(SETTINGS_DB_CACHE_KEY, { ttlMs: 5 * 60 * 1000 }) : null

  if (cachedSettings) {
    form.value = { ...cachedSettings }
    form.value.WEBHOOK_URL = cachedSettings.WEBHOOK_URL || ''
    form.value.CAPTCHA_SITE_URL = cachedSettings.CAPTCHA_SITE_URL || ''
    form.value.MESSAGE_FILTER_RULES = cachedSettings.MESSAGE_FILTER_RULES || '[]'
    webhookUrl.value = cachedSettings.WEBHOOK_URL || ''
    loading.value = false
    resolveAdminProfiles()
  }
  if (cachedDbInfo) dbInfo.value = cachedDbInfo

  try {
    const [data, db] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/settings/db'),
    ])
    form.value = data
    dbInfo.value = db
    form.value.WEBHOOK_URL = data.WEBHOOK_URL || ''
    webhookUrl.value = data.WEBHOOK_URL || ''
    form.value.CAPTCHA_SITE_URL = data.CAPTCHA_SITE_URL || ''
    form.value.MESSAGE_FILTER_RULES = data.MESSAGE_FILTER_RULES || '[]'

    syncSettingsCache()
    writeLocalCache(SETTINGS_DB_CACHE_KEY, dbInfo.value)

    resolveAdminProfiles()
  } catch (e) {
    saveErr.value = t('settings.loadFailed', { err: e.message })
    showSaveErr.value = true
  } finally {
    loading.value = false
  }
}

function clampTimeout() {
  const v = parseInt(form.value.VERIFICATION_TIMEOUT, 10)
  if (isNaN(v) || v < 60) form.value.VERIFICATION_TIMEOUT = '60'
}

function clampInlineKbDelete() {
  const v = parseInt(form.value.INLINE_KB_MSG_DELETE_SECONDS, 10)
  if (isNaN(v) || v < 0) form.value.INLINE_KB_MSG_DELETE_SECONDS = '30'
  else if (v > 600) form.value.INLINE_KB_MSG_DELETE_SECONDS = '600'
  else form.value.INLINE_KB_MSG_DELETE_SECONDS = String(v)
}

function clampLoginSessionTtl() {
  const v = parseInt(form.value.LOGIN_SESSION_TTL, 10)
  if (isNaN(v) || v < 300) form.value.LOGIN_SESSION_TTL = '300'
  else if (v > 2592000) form.value.LOGIN_SESSION_TTL = '2592000'
  else form.value.LOGIN_SESSION_TTL = String(v)
}

async function save() {
  clampTimeout()
  clampInlineKbDelete()
  clampLoginSessionTtl()
  saving.value = true
  saved.value = false
  saveErr.value = ''
  showSaveErr.value = false
  try {
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    form.value.MESSAGE_FILTER_RULES = form.value.MESSAGE_FILTER_RULES || '[]'
    await api.put('/api/settings', form.value)
    saved.value = true
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    syncSettingsCache()
    setTimeout(() => { saved.value = false }, 3000)
  } catch (e) {
    saveErr.value = e.message
    showSaveErr.value = true
  } finally {
    saving.value = false
  }
}

async function testToken() {
  testingTok.value = true
  tokResult.value = null
  try { tokResult.value = await api.post('/api/settings/test-token', { token: form.value.BOT_TOKEN }) }
  catch (e) { tokResult.value = { ok: false, err: e.message } }
  finally { testingTok.value = false }
}

async function resolveChat(val, which) {
  if (!val) return
  if (which === 'group') {
    resolvingGroup.value = true
    groupInfo.value = null
    groupErr.value = ''
  } else {
    resolvingCustom.value = true
    customInfo.value = null
  }
  try {
    const d = await api.post('/api/tg/resolve-chat', { chatId: val })
    if (which === 'group') groupInfo.value = d.chat
    else customInfo.value = d.chat
  } catch (e) {
    if (which === 'group') groupErr.value = e.message
  } finally {
    if (which === 'group') resolvingGroup.value = false
    else resolvingCustom.value = false
  }
}

async function setWebhook() {
  settingWh.value = true
  whResult.value = null
  try {
    whResult.value = await api.post('/api/settings/webhook', { webhookUrl: webhookUrl.value })
    form.value.WEBHOOK_URL = webhookUrl.value || ''
    if (!form.value.CAPTCHA_SITE_URL && webhookUrl.value) {
      form.value.CAPTCHA_SITE_URL = new URL(webhookUrl.value).origin
    }
    syncSettingsCache()
  } catch (e) {
    whResult.value = { ok: false, err: e.message }
  } finally {
    settingWh.value = false
  }
}

async function switchDb(target, sync = true) {
  dbSwitching.value = true
  dbMsg.value = ''
  const targetLabel = target === 'hyperdrive' ? t('settings.storage.hyperdriveShort')
    : target === 'd1' ? t('settings.storage.d1Short') : t('settings.storage.kvShort')
  try {
    await api.post('/api/settings/db/switch', { target, sync })
    dbInfo.value.active = target
    writeLocalCache(SETTINGS_DB_CACHE_KEY, dbInfo.value)
    dbMsg.value = t('settings.storage.switched', { target: targetLabel })
    dbOk.value = true
  } catch (e) {
    dbMsg.value = e.message
    dbOk.value = false
  } finally {
    dbSwitching.value = false
  }
}

function buildSqlFileName(active) {
  const kind = String(active || dbInfo.value.active || 'kv').toUpperCase()
  return `${kind}.sql`
}

function parseContentDispositionFileName(header) {
  const value = String(header || '')
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1]

  const plainMatch = value.match(/filename=([^;]+)/i)
  return plainMatch?.[1] ? plainMatch[1].trim() : ''
}

function downloadSqlFile(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function pickSqlFile() {
  if (sqlBusy.value) return
  sqlFileInput.value?.click()
}

async function exportSql() {
  if (sqlBusy.value) return
  sqlExporting.value = true
  sqlMsg.value = ''

  try {
    const headers = {}
    const token = localStorage.getItem('token')
    const locale = localStorage.getItem('ui_locale')

    if (token) headers.Authorization = `Bearer ${token}`
    if (locale) headers['X-Locale'] = locale

    if (sqlExportMode.value === 'aes' && !sqlExportPassword.value) {
      throw new Error(t('settings.storage.sqlAesPasswordRequired'))
    }

    headers['Content-Type'] = 'application/json'

    const response = await fetch('/api/settings/sql/export', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        mode: sqlExportMode.value,
        password: sqlExportMode.value === 'aes' ? sqlExportPassword.value : '',
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || t('store.api.requestFailed'))
    }

    const blob = await response.blob()
    const fileName = parseContentDispositionFileName(response.headers.get('Content-Disposition')) || buildSqlFileName(response.headers.get('X-Active-Db'))
    downloadSqlFile(blob, fileName)
    sqlFileName.value = fileName
    sqlMsg.value = t('settings.storage.sqlExported', { name: fileName })
    sqlOk.value = true
  } catch (e) {
    sqlMsg.value = e.message
    sqlOk.value = false
  } finally {
    sqlExporting.value = false
  }
}

async function handleSqlFileChange(event) {
  const file = event?.target?.files?.[0]
  if (!file) return

  pendingSqlEvent.value = event
  showSqlImportDialog.value = true
}

async function confirmSqlImport() {
  const event = pendingSqlEvent.value
  const file = event?.target?.files?.[0]
  if (!file) {
    showSqlImportDialog.value = false
    pendingSqlEvent.value = null
    return
  }

  showSqlImportDialog.value = false
  sqlImporting.value = true
  sqlMsg.value = ''
  sqlFileName.value = file.name

  try {
    const sql = await file.text()
    await api.post('/api/settings/sql/import', { sql, password: sqlImportPassword.value || '' }, { timeout: 5 * 60 * 1000 })
    await load(true)
    sqlMsg.value = t('settings.storage.sqlImported', { name: file.name })
    sqlOk.value = true
  } catch (e) {
    sqlMsg.value = e.message
    sqlOk.value = false
  } finally {
    sqlImporting.value = false
    if (event?.target) event.target.value = ''
    pendingSqlEvent.value = null
  }
}

function cancelSqlImport() {
  showSqlImportDialog.value = false
  const event = pendingSqlEvent.value
  if (event?.target) event.target.value = ''
  pendingSqlEvent.value = null
}

async function clearData() {
  if (clearingData.value) return

  showClearDataDialog.value = false
  clearingData.value = true
  dbMsg.value = ''

  try {
    await api.post('/api/settings/clear-data', {})
    dbMsg.value = t('settings.storage.cleared')
    dbOk.value = true
    await auth.logout()
    router.push('/login')
  } catch (e) {
    dbMsg.value = e.message
    dbOk.value = false
  } finally {
    clearingData.value = false
  }
}

watch(adminList, () => {
  resolveAdminProfiles()
})

watch(form, () => {
  syncSettingsCache()
}, { deep: true })

watch(webhookUrl, () => {
  syncSettingsCache()
})

watch(zalgoFilterEnabled, () => {
  syncSettingsCache()
  resolveAdminProfiles()
})

watch([messageFilterType, messageFilterValue], () => {
  messageFilterErr.value = ''
})

watch(saveErr, (val) => {
  if (val) showSaveErr.value = true
})

onMounted(load)
</script>
