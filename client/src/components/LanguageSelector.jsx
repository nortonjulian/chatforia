import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { fetchLanguages } from '@/api/languages';

export default function LanguageSelector({ currentLanguage = 'en', onChange }) {
  const { t } = useTranslation();
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
            ? list.filter(
                (l) => typeof l.code === 'string' && typeof l.name === 'string'
              )
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

  return (
    <Select
      label={t('profile.preferredLanguage', 'Preferred language')}
      placeholder={t('profile.chooseLanguage', 'Choose a language')}
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
      nothingFoundMessage={t('common.noMatches', 'No matches')}
      radius="md"
      disabled={loading || options.length === 0}
    />
  );
}

LanguageSelector.propTypes = {
  currentLanguage: PropTypes.string,
  onChange: PropTypes.func,
};
