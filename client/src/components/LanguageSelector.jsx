import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { fetchLanguages } from '@/api/languages';

export default function LanguageSelector({ currentLanguage = 'en', onChange }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(currentLanguage);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);

  // keep internal selected in sync with prop
  useEffect(() => {
    setSelected(currentLanguage);
  }, [currentLanguage]);

  // load languages once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchLanguages()
      .then((list) => {
        if (!cancelled) {
          const valid = Array.isArray(list)
            ? list.filter((l) => typeof l.code === 'string' && typeof l.name === 'string')
            : [];
          // you could use `valid` instead of `list` to enforce shape
          setCodes(Array.isArray(list) ? list : []);
        }
      })
      .catch(() => {
        if (!cancelled) setCodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    if (!Array.isArray(codes)) return [];
    return codes.map(({ code, name }) => ({
      value: code,
      label: name || code,
    }));
  }, [codes]);

  // when `selected` changes, drive i18n
  useEffect(() => {
    if (!selected || selected === i18n.resolvedLanguage) return;
    let cancelled = false;

    console.log('🌐 Changing language to:', selected);

    i18n
      .loadLanguages(selected)
      .then(() => {
        if (!cancelled) {
          return i18n.changeLanguage(selected);
        }
      })
      .catch((err) => console.error('changeLanguage error', err));

    return () => {
      cancelled = true;
    };
  }, [selected, i18n]);

  return (
    <Select
      label={t('profile.preferredLanguage')}
      placeholder={t('profile.chooseLanguage')}
      searchable
      clearable={false}
      data={options}
      value={selected}
      onChange={(val) => {
        if (typeof val === 'string' && val) {
          setSelected(val);
          onChange?.(val);
        }
      }}
      nothingFoundMessage={t('common.noMatches')}
      radius="md"
      disabled={loading || options.length === 0}
    />
  );
}

LanguageSelector.propTypes = {
  currentLanguage: PropTypes.string,
  onChange: PropTypes.func,
};

// (unused helper; safe to remove if you want)
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
