<script>
// Override of upstream `app/javascript/shared/components/Branding.vue`.
// Renders the 'Powered by …' label using per-inbox branding settings stored in
// the DB (custom_branding_text / custom_branding_url). Falls back to the i18n
// key POWERED_BY when no custom text is configured. If a URL is provided the
// label becomes a clickable link that opens in a new tab; otherwise it stays
// as a plain non-navigating span.
import { mapGetters } from 'vuex';

export default {
  name: 'Branding',
  computed: {
    ...mapGetters({
      customBrandingText: 'appConfig/getCustomBrandingText',
      customBrandingUrl: 'appConfig/getCustomBrandingUrl',
    }),
    brandingLabel() {
      return this.customBrandingText || this.$t('POWERED_BY');
    },
    hasLink() {
      return !!this.customBrandingUrl;
    },
  },
};
</script>

<template>
  <div class="branding flex items-center justify-center text-xs text-n-slate-11">
    <a
      v-if="hasLink"
      :href="customBrandingUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="branding__link"
    >
      {{ brandingLabel }}
    </a>
    <span v-else class="branding__label">{{ brandingLabel }}</span>
  </div>
</template>

<style scoped>
.branding {
  user-select: none;
  padding: 4px 0;
}
.branding__label,
.branding__link {
  font-weight: 500;
}
.branding__link {
  color: inherit;
  text-decoration: none;
}
.branding__link:hover {
  text-decoration: underline;
}
</style>
