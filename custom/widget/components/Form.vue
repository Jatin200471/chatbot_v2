<script>
import CustomButton from 'shared/components/Button.vue';
import Spinner from 'shared/components/Spinner.vue';
import { mapGetters } from 'vuex';
import { getContrastingTextColor } from '@chatwoot/utils';
import { isEmptyObject } from 'widget/helpers/utils';
import { getRegexp } from 'shared/helpers/Validators';
import { useMessageFormatter } from 'shared/composables/useMessageFormatter';
import configMixin from 'widget/mixins/configMixin';
import { emitter } from 'shared/helpers/mitt';
import { FormKit, createInput } from '@formkit/vue';
import PhoneInput from 'widget/components/Form/PhoneInput.vue';

export default {
  components: {
    CustomButton,
    Spinner,
    FormKit,
  },
  mixins: [configMixin],
  props: {
    options: {
      type: Object,
      default: () => {},
    },
  },
  emits: ['submitPreChat'],
  mounted() {
    emitter.on('prefill-form-data', this._applyPrefill);
    // Note: localStorage pre-fill is done in data() so FormKit gets the
    // values on first render. _applyPrefill here is only for the parent-page
    // cookie prefill event (sdk-floating-btn.js → prefill-form-data).
  },
  beforeUnmount() {
    emitter.off('prefill-form-data', this._applyPrefill);
  },
  setup() {
    const phoneInput = createInput(PhoneInput, {
      props: ['hasErrorInPhoneInput'],
    });
    const { formatMessage } = useMessageFormatter();

    return { formatMessage, phoneInput };
  },
  data() {
    // Read saved user data + restart flag from localStorage before FormKit renders.
    // FormKit only reads v-model at initialization — setting later has no effect.
    let savedValues = {};
    let isRestartMode = false;
    try {
      const raw = localStorage.getItem('chatwoot_user_data');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.name || saved.email || saved.phone_number) {
          savedValues = {
            fullName:     saved.name         || '',
            emailAddress: saved.email        || '',
            phoneNumber:  saved.phone_number || '',
          };
        }
      }
      // Restart mode = hide message box, use default message on submit
      isRestartMode = localStorage.getItem('cw_restart_mode') === '1';
    } catch (_) {}

    return {
      locale: this.$root.$i18n.locale,
      hasErrorInPhoneInput: false,
      message: '',
      isRestartMode,
      formValues: savedValues,
      labels: {
        emailAddress: 'EMAIL_ADDRESS',
        fullName: 'FULL_NAME',
        phoneNumber: 'PHONE_NUMBER',
      },
    };
  },
  computed: {
    ...mapGetters({
      widgetColor: 'appConfig/getWidgetColor',
      isCreating: 'conversation/getIsCreating',
      isConversationRouting: 'appConfig/getIsUpdatingRoute',
      activeCampaign: 'campaign/getActiveCampaign',
      currentUser: 'contacts/getCurrentUser',
    }),
    isCreatingConversation() {
      return this.isCreating || this.isConversationRouting;
    },
    buttonBgColor() {
      // Use admin-configured CTA color when set
      const ctaBg = window.chatwootWebChannel?.ctaBgColor;
      if (ctaBg) return ctaBg;
      const color = this.widgetColor;
      if (!color) return color;
      if (
        color.startsWith('linear-gradient') ||
        color.startsWith('radial-gradient')
      ) {
        const match = color.match(/#[a-fA-F0-9]{3,8}/);
        return match ? match[0] : '#1f93ff';
      }
      return color;
    },
    textColor() {
      const ctaText = window.chatwootWebChannel?.ctaTextColor;
      if (ctaText) return ctaText;
      return getContrastingTextColor(this.buttonBgColor);
    },
    hasActiveCampaign() {
      return !isEmptyObject(this.activeCampaign);
    },
    shouldShowHeaderMessage() {
      return (
        this.hasActiveCampaign ||
        (this.preChatFormEnabled && !!this.headerMessage)
      );
    },
    headerMessage() {
      if (this.preChatFormEnabled) {
        return this.options.preChatMessage;
      }
      if (this.hasActiveCampaign) {
        return this.$t('PRE_CHAT_FORM.CAMPAIGN_HEADER');
      }
      return '';
    },
    preChatFields() {
      return this.preChatFormEnabled ? this.options.preChatFields : [];
    },
    filteredPreChatFields() {
      // Always show all enabled fields — never hide based on currentUser state.
      // Each session is fresh so we always need full input from the user.
      return this.preChatFields;
    },
    enabledPreChatFields() {
      return this.filteredPreChatFields
        .filter(field => field.enabled)
        .map(field => ({
          ...field,
          type:
            field.name === 'phoneNumber'
              ? this.phoneInput
              : this.findFieldType(field.type),
        }));
    },
    conversationCustomAttributes() {
      let conversationAttributes = {};
      this.enabledPreChatFields.forEach(field => {
        if (field.field_type === 'conversation_attribute') {
          conversationAttributes = {
            ...conversationAttributes,
            [field.name]: this.getValue(field),
          };
        }
      });
      return conversationAttributes;
    },
    contactCustomAttributes() {
      let contactAttributes = {};
      this.enabledPreChatFields.forEach(field => {
        if (field.field_type === 'contact_attribute') {
          contactAttributes = {
            ...contactAttributes,
            [field.name]: this.getValue(field),
          };
        }
      });
      return contactAttributes;
    },
  },
  methods: {
    _applyPrefill({ name, email, phone }) {
      // Only fill fields that are empty — don't overwrite what user already typed
      if (name  && !this.formValues.fullName)      this.formValues.fullName      = name;
      if (email && !this.formValues.emailAddress)  this.formValues.emailAddress  = email;
      if (phone && !this.formValues.phoneNumber)   this.formValues.phoneNumber   = phone;
    },
    labelClass(input) {
      const { state } = input.context;
      const hasErrors = state.invalid;
      return !hasErrors ? 'text-n-slate-12' : 'text-n-ruby-10';
    },
    inputClass(input) {
      const { state, family: classification, type } = input.context;
      const hasErrors = state.invalid;
      if (classification === 'box' && type === 'checkbox') {
        return '';
      }
      if (type === 'phoneInput') {
        this.hasErrorInPhoneInput = hasErrors;
      }
      if (!hasErrors) {
        return `mt-1 rounded w-full py-2 px-3`;
      }
      return `mt-1 rounded w-full py-2 px-3 error`;
    },
    isContactFieldRequired(field) {
      return this.preChatFields.find(option => option.name === field).required;
    },
    getLabel({ label }) {
      return label;
    },
    getPlaceHolder({ placeholder }) {
      return placeholder;
    },
    getValue({ name, type }) {
      if (type === 'select') {
        return this.enabledPreChatFields.find(option => option.name === name)
          .values[this.formValues[name]];
      }
      return this.formValues[name] || null;
    },
    getValidation({ type, name, field_type, regex_pattern }) {
      let regex = regex_pattern ? getRegexp(regex_pattern) : null;
      const validations = {
        emailAddress: 'email',
        phoneNumber: ['startsWithPlus', 'isValidPhoneNumber'],
        url: 'url',
        date: 'date',
        text: null,
        select: null,
        number: null,
        checkbox: false,
        contact_attribute: regex ? [['matches', regex]] : null,
        conversation_attribute: regex ? [['matches', regex]] : null,
      };
      const validationKeys = Object.keys(validations);
      const isRequired = this.isContactFieldRequired(name);
      const validation = isRequired ? ['required'] : ['optional'];

      if (
        validationKeys.includes(name) ||
        validationKeys.includes(type) ||
        validationKeys.includes(field_type)
      ) {
        const validationType =
          validations[type] || validations[name] || validations[field_type];
        const allValidations = validationType
          ? validation.concat(validationType)
          : validation;
        return allValidations.join('|');
      }

      return '';
    },
    findFieldType(type) {
      if (type === 'link') {
        return 'url';
      }
      if (type === 'list') {
        return 'select';
      }

      return type;
    },
    getOptions(item) {
      if (item.type === 'select') {
        let values = {};
        item.values.forEach((value, index) => {
          values = {
            ...values,
            [index]: value,
          };
        });
        return values;
      }
      return {};
    },
    onSubmit() {
      const emailAddress = this.formValues.emailAddress || '';
      const fullName     = this.formValues.fullName     || '';
      const phoneNumber  = this.formValues.phoneNumber  || '';

      // In restart / campaign mode the message box is hidden; use a silent
      // default so the conversation is created correctly without user input.
      let message = (this.formValues.message || '').trim();
      if ((this.isRestartMode || this.hasActiveCampaign) && !message) {
        message = 'Hello';
      }

      if (!message) {
        console.error('[Form.onSubmit] Message is empty after trim');
        return;
      }

      // Clear restart mode flag so next fresh session shows the message box.
      try { localStorage.removeItem('cw_restart_mode'); } catch (_) {}

      // ── Persist to localStorage so greetings/exit-chat always reflect
      //    the CURRENT session's name, not a previous session's name.
      try {
        localStorage.setItem(
          'chatwoot_user_data',
          JSON.stringify({
            name: fullName,
            email: emailAddress,
            phone_number: phoneNumber,
            submitted_at: new Date().toISOString(),
          })
        );
      } catch (_) {}

      // ── DO NOT call contacts/update here ──────────────────────────────────
      // Calling PATCH /widget/contact before the conversation is created means
      // there is no auth token yet on a fresh session → server returns 422
      // Unprocessable Content, which breaks the session entirely.
      // The conversation create endpoint (POST /widget/conversations) already
      // runs ContactIdentifyAction with the supplied email/name/phone, so the
      // contact record is updated as part of that single transactional call.
      // ──────────────────────────────────────────────────────────────────────

      // Send to n8n webhook silently (fire and forget)
      this.sendToN8n({ name: fullName, email: emailAddress, phone_number: phoneNumber });

      this.$emit('submitPreChat', {
        fullName,
        phoneNumber,
        emailAddress,
        message,
        activeCampaignId: this.activeCampaign.id,
        conversationCustomAttributes: this.conversationCustomAttributes,
        contactCustomAttributes: this.contactCustomAttributes,
      });
    },
    async sendToN8n(userData) {
      try {
        const n8nWebhookUrl = this.options?.n8n_webhook_url || this.options?.webhook_url;
        if (!n8nWebhookUrl) return;

        const payload = {
          source: 'chatwoot-widget',
          type: 'prechat_form_submission',
          user: userData,
          website_token: window.chatwootWebChannel?.websiteToken || '',
          timestamp: new Date().toISOString(),
        };

        await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (_) {
        // Silent fail — never break the chat flow
      }
    },
  },
};
</script>

<template>
  <FormKit
    v-model="formValues"
    type="form"
    form-class="flex flex-col flex-1 w-full p-6 overflow-y-auto"
    :incomplete-message="false"
    :submit-attrs="{
      inputClass: 'hidden',
      wrapperClass: 'hidden',
    }"
    @submit="onSubmit"
  >
    <div
      v-if="shouldShowHeaderMessage"
      v-dompurify-html="formatMessage(headerMessage, false)"
      class="mb-4 text-base leading-5 text-n-slate-12 [&>p>.link]:text-n-blue-11 [&>p>.link]:hover:underline"
    />
    <FormKit
      v-for="item in enabledPreChatFields"
      :key="item.name"
      :name="item.name"
      :type="item.type"
      :label="getLabel(item)"
      :placeholder="getPlaceHolder(item)"
      :validation="getValidation(item)"
      v-bind="
        item.type === 'select'
          ? {
              options: getOptions(item),
            }
          : undefined
      "
      :label-class="context => `text-sm font-medium ${labelClass(context)}`"
      :input-class="context => inputClass(context)"
      :validation-messages="{
        startsWithPlus: $t(
          'PRE_CHAT_FORM.FIELDS.PHONE_NUMBER.DIAL_CODE_VALID_ERROR'
        ),
        isValidPhoneNumber: $t('PRE_CHAT_FORM.FIELDS.PHONE_NUMBER.VALID_ERROR'),
        email: $t('PRE_CHAT_FORM.FIELDS.EMAIL_ADDRESS.VALID_ERROR'),
        required: $t('PRE_CHAT_FORM.REQUIRED'),
        matches: item.regex_cue
          ? item.regex_cue
          : $t('PRE_CHAT_FORM.REGEX_ERROR'),
      }"
      :has-error-in-phone-input="hasErrorInPhoneInput"
    />
    <FormKit
      v-if="!hasActiveCampaign && !isRestartMode"
      name="message"
      type="textarea"
      :label-class="context => `text-sm font-medium ${labelClass(context)}`"
      :input-class="context => inputClass(context)"
      :label="$t('PRE_CHAT_FORM.FIELDS.MESSAGE.LABEL')"
      :placeholder="$t('PRE_CHAT_FORM.FIELDS.MESSAGE.PLACEHOLDER')"
      validation="required"
      :validation-messages="{
        required: $t('PRE_CHAT_FORM.FIELDS.MESSAGE.ERROR'),
      }"
    />

    <div class="mt-3 mb-5">
      <CustomButton
        class="font-medium flex items-center justify-center gap-2"
        block
        :bg-color="buttonBgColor"
        :text-color="textColor"
        :disabled="isCreatingConversation"
      >
        <Spinner v-if="isCreatingConversation" class="p-0" />
        {{ $t('START_CONVERSATION') }}
      </CustomButton>
    </div>
  </FormKit>
</template>

<style lang="scss">
.formkit-outer {
  @apply mt-2;

  .formkit-inner {
    input.error,
    textarea.error,
    select.error {
      @apply outline-n-ruby-8 dark:outline-n-ruby-8 hover:outline-n-ruby-9 dark:hover:outline-n-ruby-9 focus:outline-n-ruby-9 dark:focus:outline-n-ruby-9;
    }

    input[type='checkbox'] {
      @apply size-4 outline-none;
    }
  }
}

[data-invalid] .formkit-message {
  @apply text-n-ruby-10 block text-xs font-normal my-0.5 w-full;
}

.formkit-outer[data-type='checkbox'] .formkit-wrapper {
  @apply flex items-center gap-2 px-0.5;
}

.formkit-messages {
  @apply list-none m-0 p-0;
}
</style>