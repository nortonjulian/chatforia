import * as deepl from "deepl-node";

let translator = null;

function getTranslator() {
  const authKey = process.env.DEEPL_API_KEY?.trim();

  if (!authKey) {
    throw new Error("DEEPL_API_KEY is missing");
  }

  if (!translator) {
    translator = new deepl.Translator(authKey, {
      serverUrl: "https://api.deepl.com"
    });
  }

  return translator;
}

export async function translate(text, targetLang, sourceLang = null) {
  const result = await getTranslator().translateText(
    text,
    sourceLang,
    targetLang
  );

  return result.text;
}