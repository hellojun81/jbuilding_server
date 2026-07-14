-- 적용 전 jbuildingmng, jbuildingrentbill을 반드시 백업한다.
-- 기존 etc_bill/ETC_BILL은 구버전 호환을 위해 삭제하지 않는다.

ALTER TABLE `jbuildingmng`
  ADD COLUMN `water_bill` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `other_bill` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `other_vat_bill` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `jbuildingrentbill`
  ADD COLUMN `water_bill` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `other_bill` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `other_vat_bill` BIGINT NOT NULL DEFAULT 0;

UPDATE `jbuildingmng`
   SET `water_bill` = COALESCE(`ETC_BILL`, 0)
 WHERE `water_bill` = 0 AND COALESCE(`ETC_BILL`, 0) <> 0;

UPDATE `jbuildingrentbill`
   SET `water_bill` = COALESCE(`etc_bill`, 0)
 WHERE `water_bill` = 0 AND COALESCE(`etc_bill`, 0) <> 0;
