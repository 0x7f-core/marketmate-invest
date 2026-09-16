CREATE TABLE `__unsupported_instruments_0008` (
  `id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `__unsupported_instruments_0008` (`id`)
SELECT `id`
FROM `instruments`
WHERE
  `market` NOT IN ('KR','US','CRYPTO')
  OR (
    `market`='KR'
    AND REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(`exchange`)),' ',''),'.',''),'_',''),'-','')
      NOT IN ('KR','KRX','NXT','KOSPI','KOSDAQ','KONEX')
  )
  OR (
    `market`='US'
    AND (
      REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(`exchange`)),' ',''),'.',''),'_',''),'-','')
        NOT IN ('US','USA','NAS','NASDAQ','NSQ','NMS','NYS','NYSE','NYQ','AMS','AMEX','ASE','NYSEAMERICAN','NYSEARCA','ARCA','CBOE','CBOEBZX','BATS','BZX','OTC','OTCQX','OTCQB')
      OR UPPER(`symbol`) LIKE '%.T'
      OR UPPER(`symbol`) LIKE '%.HK'
      OR UPPER(`symbol`) LIKE '%.SS'
      OR UPPER(`symbol`) LIKE '%.SZ'
      OR UPPER(`symbol`) LIKE '%.L'
      OR UPPER(`symbol`) LIKE '%.DE'
      OR UPPER(`symbol`) LIKE '%.F'
      OR UPPER(`symbol`) LIKE '%.PA'
      OR UPPER(`symbol`) LIKE '%.TO'
      OR UPPER(`symbol`) LIKE '%.V'
      OR UPPER(`symbol`) LIKE '%.AX'
      OR UPPER(`symbol`) LIKE '%.NS'
      OR UPPER(`symbol`) LIKE '%.BO'
      OR UPPER(`symbol`) LIKE '%.SI'
      OR UPPER(`symbol`) LIKE '%.KS'
      OR UPPER(`symbol`) LIKE '%.KQ'
      OR UPPER(`symbol`) LIKE '%.TW'
      OR UPPER(`symbol`) LIKE '%.TWO'
      OR UPPER(`symbol`) LIKE '%.MI'
      OR UPPER(`symbol`) LIKE '%.AS'
      OR UPPER(`symbol`) LIKE '%.BR'
      OR UPPER(`symbol`) LIKE '%.S'
      OR UPPER(`symbol`) LIKE '%.ST'
      OR UPPER(`symbol`) LIKE '%.HE'
      OR UPPER(`symbol`) LIKE '%.CO'
      OR UPPER(`symbol`) LIKE '%.OL'
      OR UPPER(`symbol`) LIKE '%.VI'
      OR UPPER(`symbol`) LIKE '%.MC'
      OR UPPER(`symbol`) LIKE '%.WA'
      OR UPPER(`symbol`) LIKE '%.PR'
      OR UPPER(`symbol`) LIKE '%.BU'
      OR UPPER(`symbol`) LIKE '%.AT'
      OR UPPER(`symbol`) LIKE '%.IR'
      OR UPPER(`symbol`) LIKE '%.JO'
      OR UPPER(`symbol`) LIKE '%.KL'
      OR UPPER(`symbol`) LIKE '%.BK'
      OR UPPER(`symbol`) LIKE '%.JK'
      OR UPPER(`symbol`) LIKE '%.J'
      OR UPPER(`symbol`) LIKE '%.SA'
      OR UPPER(`symbol`) LIKE '%.MX'
    )
  );
--> statement-breakpoint
DELETE FROM `watchlist_items`
WHERE `instrument_id` IN (SELECT `id` FROM `__unsupported_instruments_0008`);
--> statement-breakpoint
DELETE FROM `quote_snapshots`
WHERE `instrument_id` IN (SELECT `id` FROM `__unsupported_instruments_0008`);
--> statement-breakpoint
DELETE FROM `price_history`
WHERE `instrument_id` IN (SELECT `id` FROM `__unsupported_instruments_0008`);
--> statement-breakpoint
UPDATE `orders`
SET `status`='rejected', `rejection_reason`='지원하지 않는 해외시장 종목', `updated_at`=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE `status`='pending'
  AND `instrument_id` IN (SELECT `id` FROM `__unsupported_instruments_0008`);
--> statement-breakpoint
UPDATE `instruments`
SET `is_active`=0
WHERE `id` IN (SELECT `id` FROM `__unsupported_instruments_0008`);
--> statement-breakpoint
DELETE FROM `instruments`
WHERE `id` IN (SELECT `id` FROM `__unsupported_instruments_0008`)
  AND NOT EXISTS (SELECT 1 FROM `orders` WHERE `orders`.`instrument_id`=`instruments`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `fills` WHERE `fills`.`instrument_id`=`instruments`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `positions` WHERE `positions`.`instrument_id`=`instruments`.`id`);
--> statement-breakpoint
DROP TABLE `__unsupported_instruments_0008`;
