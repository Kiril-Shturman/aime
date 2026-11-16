import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePassportText } from "../src/wallet/passport-ocr.ts";

test("labelled Russian passport fields become editable API values", () => {
  assert.deepEqual(
    parsePassportText(
      `Фамилия ИВАНОВ\nИмя ИВАН\nОтчество ИВАНОВИЧ\nДата рождения 01.02.1990\nДата выдачи 03.04.2010\n12 34 567890`,
    ),
    {
      first_name: "ИВАН",
      last_name: "ИВАНОВ",
      patronymic: "ИВАНОВИЧ",
      birth_date: "1990-02-01",
      passport_issue_date: "2010-04-03",
      passport: "1234567890",
    },
  );
});
test("names on following lines, hyphens, and spaces are preserved", () => {
  const fields = parsePassportText(
    "ФАМИЛИЯ\nПЕТРОВА-СИДОРОВА\nИМЯ\nАННА МАРИЯ\nДАТА РОЖДЕНИЯ\n29.02.2000",
  );
  assert.equal(fields.last_name, "ПЕТРОВА-СИДОРОВА");
  assert.equal(fields.first_name, "АННА МАРИЯ");
  assert.equal(fields.birth_date, "2000-02-29");
});
test("no guessing names, ambiguous passport numbers, or impossible dates", () => {
  assert.deepEqual(
    parsePassportText(
      "РОССИЙСКАЯ ФЕДЕРАЦИЯ\nИВАНОВ\nМВД РОССИИ\nДата рождения 31.02.1990\nДата выдачи 30.13.2010\n12 34 567890\n12 34 567891",
    ),
    {},
  );
  assert.equal(parsePassportText("Фамилия\nИмя\nИВАН").last_name, undefined);
  assert.equal(
    parsePassportText("Дата рождения 01.01.2000\nДата выдачи 01.01.1999")
      .passport_issue_date,
    undefined,
  );
});
