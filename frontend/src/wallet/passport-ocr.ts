export type PassportField =
  | "first_name"
  | "last_name"
  | "patronymic"
  | "birth_date"
  | "passport"
  | "passport_issue_date";
export type PassportFields = Partial<Record<PassportField, string>>;

function isoDate(value: string): string | undefined {
  const match = /\b(\d{2})\s*[.\-/]\s*(\d{2})\s*[.\-/]\s*(\d{4})\b/.exec(value);
  if (!match) return;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  )
    return;
  if (+year < 1900 || iso > new Date().toISOString().slice(0, 10)) return;
  return iso;
}

// Only use labelled fields. Do not guess identity from arbitrary uppercase words
// (issuing offices and place names otherwise look like names on passport spreads).
export function parsePassportText(text: string): PassportFields {
  const lines = text
    .normalize("NFKC")
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const result: PassportFields = {};
  const labelled = (label: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const match = label.exec(lines[i]);
      if (!match) continue;
      const rest = lines[i]
        .slice(match.index + match[0].length)
        .replace(
          /\/\s*(?:SURNAME|GIVEN NAMES?|PATRONYMIC|DATE OF BIRTH|DATE OF ISSUE)/g,
          "",
        )
        .replace(/^[\s:;.,—-]+/, "")
        .trim();
      return rest || lines[i + 1] || "";
    }
    return "";
  };
  for (const [field, label] of [
    ["last_name", /ФАМИЛИЯ/],
    ["first_name", /(?:^|\s)ИМЯ(?:\s|:|$)/],
    ["patronymic", /ОТЧЕСТВО/],
  ] as const) {
    const value = labelled(label);
    if (
      /^[А-ЯЁ]+(?:[ -][А-ЯЁ]+)*$/.test(value) &&
      value.length <= 100 &&
      !/^(?:ИМЯ|ФАМИЛИЯ|ОТЧЕСТВО)$|ДАТА|ПАСПОРТ|РОЖДЕНИЯ|ВЫДАЧИ/.test(value)
    )
      result[field] = value;
  }
  const dateText = lines.join("\n");
  const birth = isoDate(
    /ДАТА\s+РОЖДЕНИЯ[\s:]*([0-9.\/\- ]+)/.exec(dateText)?.[1] ||
      labelled(/ДАТА\s+РОЖДЕНИЯ/),
  );
  const issued = isoDate(
    /ДАТА\s+ВЫДАЧИ[\s:]*([0-9.\/\- ]+)/.exec(dateText)?.[1] ||
      labelled(/ДАТА\s+ВЫДАЧИ/),
  );
  if (birth) result.birth_date = birth;
  if (issued && (!birth || issued > birth)) result.passport_issue_date = issued;
  const numbers = [
    ...text.matchAll(/(?:^|[^\d])(\d{2})[ \t]*(\d{2})\s*(\d{6})(?!\d)/gm),
  ].map((match) => match[1] + match[2] + match[3]);
  const unique = [...new Set(numbers)];
  if (unique.length === 1) result.passport = unique[0];
  return result;
}
