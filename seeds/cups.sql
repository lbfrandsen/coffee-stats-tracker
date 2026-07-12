INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_FCK_NFC_UID', 'FCK'
FROM persons
WHERE name = 'Lucas';

INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_MUNCHEN_NFC_UID', 'München'
FROM persons
WHERE name = 'Lucas';

INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_EVA_TRIO_NFC_UID', 'Eva trio'
FROM persons
WHERE name = 'Frederik';

INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_ROYAL_COPENHAGEN_NFC_UID', 'Royal Copenhagen kop med hank'
FROM persons
WHERE name = 'Lucas';

INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_DTU_KEMI_NFC_UID', 'DTU Kemi'
FROM persons
WHERE name = 'Lucas';

INSERT INTO cups (owner_id, nfc_uid, name)
SELECT id, 'REPLACE_WITH_SORT_TERMOS_NFC_UID', 'Sort termos'
FROM persons
WHERE name = 'Lucas';