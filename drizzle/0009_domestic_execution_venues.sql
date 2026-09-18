ALTER TABLE `orders` ADD COLUMN `venue` text;
--> statement-breakpoint
ALTER TABLE `fills` ADD COLUMN `venue` text;
--> statement-breakpoint
UPDATE `orders`
SET `venue` = CASE
  WHEN UPPER(COALESCE((SELECT i.exchange FROM instruments i WHERE i.id = orders.instrument_id), '')) = 'NXT' THEN 'NXT'
  ELSE 'KRX'
END
WHERE EXISTS (
  SELECT 1 FROM instruments i WHERE i.id = orders.instrument_id AND i.market = 'KR'
);
--> statement-breakpoint
UPDATE `fills`
SET `venue` = CASE
  WHEN UPPER(COALESCE((SELECT i.exchange FROM instruments i WHERE i.id = fills.instrument_id), '')) = 'NXT' THEN 'NXT'
  ELSE 'KRX'
END
WHERE EXISTS (
  SELECT 1 FROM instruments i WHERE i.id = fills.instrument_id AND i.market = 'KR'
);
