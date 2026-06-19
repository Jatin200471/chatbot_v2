with open('D:/chatwoot-custom-master/custom/dashboard/Settings.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# ── 1. Add custom data fields ──────────────────────────────────────────────
old1 = "      widgetBubbleLauncherTitle: '',\n    };"
new1 = """      widgetBubbleLauncherTitle: '',
      cwWidgetBgColor: '',
      cwWidgetBgImageUrl: '',
      cwFontFamily: '',
      cwWelcomeHeadingColor: '',
      cwWelcomeHeadingSize: 24,
      cwWelcomeTaglineColor: '',
      cwWelcomeTaglineSize: 14,
      cwOnlineStatusColor: '',
      cwReplyTimeColor: '',
      cwCtaBgColor: '',
      cwCtaTextColor: '',
      cwBotBubbleBgColor: '',
      cwBotBubbleTextColor: '',
      cwUserBubbleBgColor: '',
      cwUserBubbleTextColor: '',
      cwInputFocusColor: '',
      cwMessageFontSize: 14,
      cwBrandingText: '',
      cwBrandingUrl: '',
      cwBubbleIconUrl: '',
      cwBubbleIconSize: 60,
      isUpdatingCwAppearance: false,
      isUpdatingCwBranding: false,
      isUpdatingCwBubbleIcon: false,
    };"""
assert old1 in content, "anchor 1 missing"
content = content.replace(old1, new1, 1)

# ── 2. Load fields in syncInboxData ───────────────────────────────────────
old2 = "        this.widgetBubbleLauncherTitle = '';\n      }\n    },\n    async fetchHealthData()"
new2 = """        this.widgetBubbleLauncherTitle = '';
      }
      this.cwWidgetBgColor = this.inbox.widget_bg_color || '';
      this.cwWidgetBgImageUrl = this.inbox.widget_bg_image_url || '';
      this.cwFontFamily = this.inbox.widget_font_family || '';
      this.cwWelcomeHeadingColor = this.inbox.welcome_heading_color || '';
      this.cwWelcomeHeadingSize = this.inbox.welcome_heading_size || 24;
      this.cwWelcomeTaglineColor = this.inbox.welcome_tagline_color || '';
      this.cwWelcomeTaglineSize = this.inbox.welcome_tagline_size || 14;
      this.cwOnlineStatusColor = this.inbox.online_status_color || '';
      this.cwReplyTimeColor = this.inbox.reply_time_color || '';
      this.cwCtaBgColor = this.inbox.cta_bg_color || '';
      this.cwCtaTextColor = this.inbox.cta_text_color || '';
      this.cwBotBubbleBgColor = this.inbox.bot_bubble_bg_color || '';
      this.cwBotBubbleTextColor = this.inbox.bot_bubble_text_color || '';
      this.cwUserBubbleBgColor = this.inbox.user_bubble_bg_color || '';
      this.cwUserBubbleTextColor = this.inbox.user_bubble_text_color || '';
      this.cwInputFocusColor = this.inbox.input_focus_color || '';
      this.cwMessageFontSize = this.inbox.message_font_size || 14;
      this.cwBrandingText = this.inbox.custom_branding_text || '';
      this.cwBrandingUrl = this.inbox.custom_branding_url || '';
      this.cwBubbleIconUrl = this.inbox.custom_bubble_icon_url || '';
      this.cwBubbleIconSize = this.inbox.custom_bubble_icon_size != null ? this.inbox.custom_bubble_icon_size : 60;
    },
    async fetchHealthData()"""
assert old2 in content, "anchor 2 missing"
content = content.replace(old2, new2, 1)

# ── 3. Add custom methods before onTabChange ──────────────────────────────
old3 = "    onTabChange(selectedTabIndex) {"
new3 = """    async updateCwAppearanceSettings() {
      this.isUpdatingCwAppearance = true;
      try {
        await this.$store.dispatch('inboxes/updateInbox', {
          id: this.inbox.id, formData: false,
          channel: {
            widget_bg_color: this.cwWidgetBgColor.trim() || null,
            widget_bg_image_url: this.cwWidgetBgImageUrl.trim() || null,
            widget_font_family: this.cwFontFamily.trim() || null,
            welcome_heading_color: this.cwWelcomeHeadingColor.trim() || null,
            welcome_heading_size: this.cwWelcomeHeadingSize ? Number(this.cwWelcomeHeadingSize) : null,
            welcome_tagline_color: this.cwWelcomeTaglineColor.trim() || null,
            welcome_tagline_size: this.cwWelcomeTaglineSize ? Number(this.cwWelcomeTaglineSize) : null,
            online_status_color: this.cwOnlineStatusColor.trim() || null,
            reply_time_color: this.cwReplyTimeColor.trim() || null,
            cta_bg_color: this.cwCtaBgColor.trim() || null,
            cta_text_color: this.cwCtaTextColor.trim() || null,
            bot_bubble_bg_color: this.cwBotBubbleBgColor.trim() || null,
            bot_bubble_text_color: this.cwBotBubbleTextColor.trim() || null,
            user_bubble_bg_color: this.cwUserBubbleBgColor.trim() || null,
            user_bubble_text_color: this.cwUserBubbleTextColor.trim() || null,
            input_focus_color: this.cwInputFocusColor.trim() || null,
            message_font_size: this.cwMessageFontSize ? Number(this.cwMessageFontSize) : null,
          },
        });
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally { this.isUpdatingCwAppearance = false; }
    },
    async updateCwBrandingSettings() {
      this.isUpdatingCwBranding = true;
      try {
        await this.$store.dispatch('inboxes/updateInbox', {
          id: this.inbox.id, formData: false,
          channel: {
            custom_branding_text: this.cwBrandingText.trim() || null,
            custom_branding_url: this.cwBrandingUrl.trim() || null,
          },
        });
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally { this.isUpdatingCwBranding = false; }
    },
    async updateCwBubbleIconSettings() {
      this.isUpdatingCwBubbleIcon = true;
      try {
        await this.$store.dispatch('inboxes/updateInbox', {
          id: this.inbox.id, formData: false,
          channel: {
            custom_bubble_icon_url: this.cwBubbleIconUrl.trim() || null,
            custom_bubble_icon_size: Number(this.cwBubbleIconSize),
          },
        });
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally { this.isUpdatingCwBubbleIcon = false; }
    },
    onTabChange(selectedTabIndex) {"""
assert old3 in content, "anchor 3 missing"
content = content.replace(old3, new3, 1)

# ── 4. Add accordion sections in template ────────────────────────────────
TEMPLATE_SECTION = '''            <template v-if="isAWebWidgetInbox">

              <SettingsAccordion title="Widget Appearance" class="mt-6">
                <div class="flex flex-col gap-5">

                  <SettingsFieldSection label="Font Family">
                    <div class="flex flex-col gap-2 max-w-md">
                      <select v-model="cwFontFamily"
                        class="px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand">
                        <option value="">Default (System Font)</option>
                        <option value="Inter">Inter</option>
                        <option value="Roboto">Roboto</option>
                        <option value="Open Sans">Open Sans</option>
                        <option value="Lato">Lato</option>
                        <option value="Poppins">Poppins</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Nunito">Nunito</option>
                        <option value="Raleway">Raleway</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="DM Sans">DM Sans</option>
                        <option value="Source Sans Pro">Source Sans Pro</option>
                        <option value="Ubuntu">Ubuntu</option>
                        <option value="Noto Sans">Noto Sans</option>
                      </select>
                      <input v-model="cwFontFamily" type="text" placeholder="Or type any Google Font name…"
                        class="px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                      <p class="text-xs text-n-slate-9">Google Fonts are loaded automatically in the widget.</p>
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Message Font Size (px)" help-text="Applies to both bot and user chat bubbles.">
                    <input v-model.number="cwMessageFontSize" type="number" min="10" max="24" placeholder="14"
                      class="w-24 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Widget Background Color">
                    <div class="flex items-center gap-2 max-w-md">
                      <ColorPicker v-model="cwWidgetBgColor" />
                      <input v-model="cwWidgetBgColor" type="text" placeholder="hex, rgb, or linear-gradient(…)"
                        class="flex-1 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Background Image URL">
                    <input v-model="cwWidgetBgImageUrl" type="url" placeholder="https://yoursite.com/bg.jpg"
                      class="w-full max-w-md px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Welcome Heading Color &amp; Size (px)">
                    <div class="flex items-center gap-2 flex-wrap">
                      <ColorPicker v-model="cwWelcomeHeadingColor" />
                      <input v-model="cwWelcomeHeadingColor" type="text" placeholder="#111"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                      <input v-model.number="cwWelcomeHeadingSize" type="number" min="12" max="48" placeholder="24"
                        class="w-20 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Welcome Tagline Color &amp; Size (px)">
                    <div class="flex items-center gap-2 flex-wrap">
                      <ColorPicker v-model="cwWelcomeTaglineColor" />
                      <input v-model="cwWelcomeTaglineColor" type="text" placeholder="#555"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                      <input v-model.number="cwWelcomeTaglineSize" type="number" min="10" max="32" placeholder="14"
                        class="w-20 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label='"We are online" Color'>
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwOnlineStatusColor" />
                      <input v-model="cwOnlineStatusColor" type="text" placeholder="#22c55e"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label='"Typically replies" Color'>
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwReplyTimeColor" />
                      <input v-model="cwReplyTimeColor" type="text" placeholder="#6b7280"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="CTA Button Background" help-text="Start Conversation &amp; Continue Conversation. Supports gradients.">
                    <div class="flex items-center gap-2 max-w-md">
                      <ColorPicker v-model="cwCtaBgColor" />
                      <input v-model="cwCtaBgColor" type="text" placeholder="#1f93ff or linear-gradient(…)"
                        class="flex-1 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="CTA Button Text Color">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwCtaTextColor" />
                      <input v-model="cwCtaTextColor" type="text" placeholder="#ffffff"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                    <div v-if="cwCtaBgColor || cwCtaTextColor" class="mt-2 flex items-center gap-2">
                      <span class="text-xs text-n-slate-9">Preview:</span>
                      <button class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium"
                        :style="{ background: cwCtaBgColor || '#1f93ff', color: cwCtaTextColor || '#ffffff' }">
                        Start Conversation
                      </button>
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Bot Message Background">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwBotBubbleBgColor" />
                      <input v-model="cwBotBubbleBgColor" type="text" placeholder="#f3f4f6"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Bot Message Text Color">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwBotBubbleTextColor" />
                      <input v-model="cwBotBubbleTextColor" type="text" placeholder="#111827"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="User Message Background">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwUserBubbleBgColor" />
                      <input v-model="cwUserBubbleBgColor" type="text" placeholder="uses widget color"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="User Message Text Color">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwUserBubbleTextColor" />
                      <input v-model="cwUserBubbleTextColor" type="text" placeholder="#ffffff"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                    <div v-if="cwBotBubbleBgColor || cwUserBubbleBgColor" class="mt-3 flex flex-col gap-2">
                      <span class="text-xs text-n-slate-9">Message preview:</span>
                      <div v-if="cwBotBubbleBgColor" class="rounded-lg px-3 py-2 text-sm w-fit max-w-xs"
                        :style="{ background: cwBotBubbleBgColor, color: cwBotBubbleTextColor || '#111827', fontSize: (cwMessageFontSize || 14) + 'px', fontFamily: cwFontFamily || 'inherit' }">
                        Hi! How can I help?
                      </div>
                      <div v-if="cwUserBubbleBgColor" class="rounded-lg px-3 py-2 text-sm w-fit max-w-xs ml-auto"
                        :style="{ background: cwUserBubbleBgColor, color: cwUserBubbleTextColor || '#ffffff', fontSize: (cwMessageFontSize || 14) + 'px', fontFamily: cwFontFamily || 'inherit' }">
                        I have a question.
                      </div>
                    </div>
                  </SettingsFieldSection>

                  <SettingsFieldSection label="Input Focus Border Color">
                    <div class="flex items-center gap-2">
                      <ColorPicker v-model="cwInputFocusColor" />
                      <input v-model="cwInputFocusColor" type="text" placeholder="uses widget color"
                        class="w-28 px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                    </div>
                  </SettingsFieldSection>

                  <div class="flex justify-end pt-2">
                    <NextButton label="Save Appearance" :is-loading="isUpdatingCwAppearance" @click="updateCwAppearanceSettings" />
                  </div>
                </div>
              </SettingsAccordion>

              <SettingsAccordion title="Custom Bubble Icon" class="mt-6">
                <div class="flex flex-col gap-4">
                  <SettingsFieldSection label="Icon Image URL" help-text="Direct link to PNG, SVG, or WebP. Leave blank to use the default icon.">
                    <input v-model="cwBubbleIconUrl" type="url" placeholder="https://yoursite.com/chat-icon.png"
                      class="w-full max-w-md px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                  </SettingsFieldSection>
                  <SettingsFieldSection label="Icon Size (% of bubble)">
                    <div class="flex items-center gap-3 max-w-xs">
                      <span class="text-xs text-n-slate-9 w-6">20</span>
                      <input v-model.number="cwBubbleIconSize" type="range" min="20" max="90" step="5" class="flex-1 accent-n-brand" />
                      <span class="text-xs text-n-slate-9 w-12">90 ({{ cwBubbleIconSize }}%)</span>
                    </div>
                    <div v-if="cwBubbleIconUrl" class="mt-3 flex items-center gap-3">
                      <span class="text-xs text-n-slate-9">Preview:</span>
                      <div class="rounded-full overflow-hidden flex items-center justify-center" style="width:56px;height:56px;"
                        :style="{ background: inbox.widget_color || '#1f93ff' }">
                        <img :src="cwBubbleIconUrl" alt="icon"
                          :style="{ width: cwBubbleIconSize + '%', height: cwBubbleIconSize + '%', objectFit: 'contain' }"
                          @error="$event.target.style.display='none'" />
                      </div>
                    </div>
                  </SettingsFieldSection>
                  <div class="flex justify-end">
                    <NextButton label="Save Bubble Icon" :is-loading="isUpdatingCwBubbleIcon" @click="updateCwBubbleIconSettings" />
                  </div>
                </div>
              </SettingsAccordion>

              <SettingsAccordion title="Widget Branding" class="mt-6">
                <div class="flex flex-col gap-4">
                  <SettingsFieldSection label="Branding Label" help-text="Leave blank to use the default Chatwoot label.">
                    <input v-model="cwBrandingText" type="text" placeholder="Powered by Your Company"
                      class="w-full max-w-md px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                  </SettingsFieldSection>
                  <SettingsFieldSection label="Branding Link URL" help-text="Makes the label clickable. Leave blank for plain text.">
                    <input v-model="cwBrandingUrl" type="url" placeholder="https://yourcompany.com"
                      class="w-full max-w-md px-3 py-2 text-sm border border-n-weak rounded-lg bg-n-background text-n-slate-12 focus:outline-none focus:border-n-brand" />
                  </SettingsFieldSection>
                  <div class="flex justify-end">
                    <NextButton label="Save Branding" :is-loading="isUpdatingCwBranding" @click="updateCwBrandingSettings" />
                  </div>
                </div>
              </SettingsAccordion>

            </template>
'''

old4 = '            <div class="w-full flex justify-end items-center py-4 mt-2">'
new4 = TEMPLATE_SECTION + old4
assert old4 in content, "anchor 4 missing"
content = content.replace(old4, new4, 1)

with open('D:/chatwoot-custom-master/custom/dashboard/Settings.vue', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. {content.count(chr(10))+1} lines")
