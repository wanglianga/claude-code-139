#!/usr/bin/env bash
# 端到端夜间全流程验证（真实 HTTP + PostgreSQL，时间统一 UTC）
# 同晚多车：正常夜停+超时申诉 / 道闸失败人工放行致错停 / 陌生占位+调度改派 / 业主回家改派 / 陌生车追缴 / 合并分账 / 时间线 / 追溯
set -u
BASE=${BASE:-http://localhost:3000/api}
J() { jq -C .; }
say() { echo; echo "==================== $* ===================="; }
tok() {
  local u=$1 p=$2
  curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$u\",\"password\":\"$p\"}" | jq -r .token
}
jget() { curl -s -H "Authorization: Bearer $1" "$BASE$2"; }
jpost() { curl -s -X POST -H "Authorization: Bearer $1" -H 'Content-Type: application/json' "$BASE$2" -d "$3"; }

say "0. 登录五个角色"
TOWNER=$(tok owner owner123); TDR=$(tok driver driver123); TDR3=$(tok driver3 driver123)
TDR4=$(tok driver4 driver123); TPROP=$(tok property property123)
echo "token 长度: ${#TOWNER}/${#TDR}/${#TDR3}/${#TDR4}/${#TPROP}"
CID=$(curl -s "$BASE/parking/communities" | jq -r '.[0].id')
D=$(date -u +%F)
echo "小区=$CID 夜间日期=$D（共享窗口 19:00Z–次日09:00Z）"

say "1. 业主发布车位 D-009（产权/充电/访客/月租优先登记）→ 物业审核 → 发布共享时段"
SPOT9=$(jpost "$TOWNER" /parking/spots "{
  \"code\":\"B2-D-009\",\"zone\":\"地下二层 D 区\",\"deedNo\":\"京(2024)朝字第0009号\",\"communityId\":\"$CID\",
  \"nearCharger\":false,\"isChargerSpot\":false,\"allowVisitor\":true,
  \"monthlyPriority\":\"monthly_first\",\"navigationHint\":\"D 区坡道右侧第 9 位\"}" | tee /dev/stderr | jq -r .id)
jpost "$TPROP" "/parking/spots/$SPOT9/review" '{"approve":true,"note":"产权证明齐全，审核通过"}' | jq '{approvalStatus,reviewNote}'
SLOT9=$(jpost "$TOWNER" /parking/slots "{\"spotId\":\"$SPOT9\",\"date\":\"$D\",\"startMinute\":1140,\"endMinute\":1980,\"guaranteed\":true}" | jq -r .id)
echo "D-009 spot=$SPOT9 slot=$SLOT9"

say "1b. 审核拦截演示：再发布一个资料不全的车位并驳回"
BAD=$(jpost "$TOWNER" /parking/spots "{
  \"code\":\"B2-E-002\",\"zone\":\"地下二层 E 区\",\"deedNo\":\"待补\",\"communityId\":\"$CID\",
  \"nearCharger\":false,\"isChargerSpot\":false,\"allowVisitor\":true,\"monthlyPriority\":\"none\"}" | jq -r .id)
jpost "$TPROP" "/parking/spots/$BAD/review" '{"approve":false,"note":"产权证号无效，请补充材料"}' | jq '{code,approvalStatus,reviewNote}'

read SLOT_A SPOT_A SLOT_C SPOT_C < <(curl -s "$BASE/parking/spots?communityId=$CID" | jq -r --arg d "$D" '
  (map(select(.code=="B2-A-018"))[0] | (.slots[]|select(.date==$d)).id + " " + .id) as $a |
  (map(select(.code=="B2-C-030"))[0] | (.slots[]|select(.date==$d)).id + " " + .id) as $c |
  $a + " " + $c')
echo "A: slot=$SLOT_A spot=$SPOT_A ; C: slot=$SLOT_C spot=$SPOT_C"

say "2. 三笔夜租预约（driver→A 用券 / driver3→C / driver4→D9）"
TOMO=$(date -u -d "+1 day" +%F)
mkres() { jpost "$1" /parking/reservations "{
  \"slotId\":\"$2\",\"plate\":\"$3\",\"startTime\":\"$4\",\"endTime\":\"$5\"${6:+,\"couponCode\":\"$6\"}}"; }
R1=$(mkres "$TDR" "$SLOT_A" "京A12345" "${D}T19:00:00Z" "${TOMO}T03:00:00Z" "NIGHT10")
echo "$R1" | jq '{plate,spot:.spot.code,startTime,endTime,estimatedFee,status}'
RID1=$(echo "$R1" | jq -r .id)
R3=$(mkres "$TDR3" "$SLOT_C" "京C66666" "${D}T19:00:00Z" "${TOMO}T03:00:00Z")
echo "$R3" | jq '{plate,spot:.spot.code,estimatedFee,status}'
RID3=$(echo "$R3" | jq -r .id)
R4=$(mkres "$TDR4" "$SLOT9" "京D77777" "${D}T19:00:00Z" "${TOMO}T04:00:00Z")
echo "$R4" | jq '{plate,spot:.spot.code,estimatedFee,status}'
RID4=$(echo "$R4" | jq -r .id)

say "2b. 规则校验：燃油车约充电车位 / 重叠时段 / 月租优先 均应被拦截"
jpost "$TDR" /parking/reservations "{\"slotId\":\"$SLOT_A\",\"plate\":\"京A12345\",\"startTime\":\"${D}T20:00:00Z\",\"endTime\":\"${D}T21:00:00Z\"}" | jq -r '.message' | sed 's/^/重叠时段 -> /'

say "3. 道闸：driver 正常识别入场 A"
jpost "$TPROP" /parking/gate/entry "{\"reservationId\":\"$RID1\",\"recognizedPlate\":\"京A12345\",\"confidence\":0.98,\"at\":\"${D}T19:05:00Z\"}" \
  | jq '{matchType,barrierOpened,navigation}'

say "3b. driver3 入场道闸识别失败 → 自动异常单；物业人工放行（指引不清）"
FAIL=$(jpost "$TPROP" /parking/gate/entry "{\"reservationId\":\"$RID3\",\"recognizedPlate\":\"京C666\",\"confidence\":0.31,\"at\":\"${D}T19:06:00Z\"}")
echo "$FAIL" | jq '{matchType,barrierOpened,hint,incidentId}'
INC_FAIL=$(echo "$FAIL" | jq -r .incidentId)
jpost "$TPROP" /parking/gate/entry "{\"reservationId\":\"$RID3\",\"manual\":true,\"verifiedPlate\":\"京C66666\",\"note\":\"人工放行，现场指引不清\",\"at\":\"${D}T19:10:00Z\"}" \
  | jq '{matchType,barrierOpened,navigation}'

say "4. driver4 到 D9 发现被陌生车占用：上报异常 + 巡查取证 + 挪车通知"
INC_S=$(jpost "$TDR4" /parking/incidents "{
  \"type\":\"stranger_occupation\",\"spotId\":\"$SPOT9\",\"reservationId\":\"$RID4\",\"involvedPlate\":\"京C66666\",
  \"description\":\"到达预约车位发现被京C66666占用，无法入场\",\"at\":\"${D}T19:14:00Z\"}")
echo "$INC_S" | jq '{type,status,involvedPlate,description}'
I_S=$(echo "$INC_S" | jq -r .id)
jpost "$TPROP" /parking/patrol "{\"spotId\":\"$SPOT9\",\"plate\":\"京C66666\",\"note\":\"D-009 被京C66666占用，其预约实为 C-030，疑跟随人工放行车辆停错\",\"at\":\"${D}T19:15:00Z\"}" \
  | jq '{patrol:.patrol|{plate,note},autoIncident:.autoIncident|{type,involvedPlate}}'
jpost "$TPROP" "/parking/incidents/$I_S/move-notice" "{\"plate\":\"京C66666\",\"channel\":\"电话+短信\",\"at\":\"${D}T19:15:00Z\"}" | jq '{plate,status,channel,sentAt}'

say "4b. 物业释放 C 车位（取消错停司机预约）并把 driver4 夜间调度改派至 C"
jpost "$TPROP" "/parking/reservations/$RID3/cancel" '{}' | jq .
DISP=$(jpost "$TPROP" /parking/dispatch "{\"reservationId\":\"$RID4\",\"targetSlotId\":\"$SLOT_C\",\"at\":\"${D}T19:20:00Z\",\"note\":\"D9 被错停车辆占用，改派至 C-030\"}")
echo "$DISP" | jq '{id,plate,spot:.spot.code,status,startTime,endTime,dispatchNote}'
RID4B=$(echo "$DISP" | jq -r .id)
jpost "$TPROP" /parking/gate/entry "{\"reservationId\":\"$RID4B\",\"recognizedPlate\":\"京D77777\",\"confidence\":0.96,\"at\":\"${D}T19:25:00Z\"}" | jq '{matchType,navigation}'

say "5. 业主 22:00 临时回家（A 车位）→ 自动挪车通知 + 系统调度 driver 至 B 充电区空位"
OR=$(jpost "$TOWNER" /parking/owner-return "{\"slotId\":\"$SLOT_A\",\"at\":\"${D}T22:00:00Z\"}")
echo "$OR" | jq '{ownerReturnedAt,incidentId,notice:.notice|{plate,status,channel},dispatched:.dispatched|{id,spot:.spot.code,status,dispatchNote}}'
RID1B=$(echo "$OR" | jq -r .dispatched.id)
jpost "$TPROP" /parking/gate/entry "{\"reservationId\":\"$RID1B\",\"recognizedPlate\":\"京A12345\",\"confidence\":0.97,\"at\":\"${D}T22:10:00Z\"}" | jq '{matchType,navigation}'

say "5b. 地下车库信号差工单（影响离场提醒送达）"
jpost "$TPROP" /parking/incidents "{\"type\":\"weak_signal\",\"spotId\":\"$SPOT_A\",\"reservationId\":\"$RID1\",\"description\":\"B2 层信号弱，App 推送普遍延迟\",\"at\":\"${D}T22:30:00Z\"}" | jq '{type,status}'

say "6. 错停司机京C66666 20:45 才离场（通知 19:15，宽限 15 分钟，迟延 60 分钟）→ 即时结算"
E3=$(jpost "$TPROP" /parking/gate/exit "{\"reservationId\":\"$RID3\",\"manual\":true,\"verifiedPlate\":\"京C66666\",\"at\":\"${D}T20:45:00Z\"}")
echo "$E3" | jq '{matchType,billing:{baseFee:.billing.baseFee,moveDelayPenalty:.billing.moveDelayPenalty,payable:.billing.payable,explanation:.billing.explanation}}'

say "7. driver4 04:00 正常离场（改派后的 C 车位）"
jpost "$TPROP" /parking/gate/exit "{\"reservationId\":\"$RID4B\",\"recognizedPlate\":\"京D77777\",\"confidence\":0.96,\"at\":\"${TOMO}T04:00:00Z\"}" \
  | jq '{billing:{baseFee:.billing.baseFee,payable:.billing.payable}}'

say "7b. driver 04:00 离场（新预约 03:00 结束 → 超时 1 小时，用券 NIGHT10）"
E1=$(jpost "$TPROP" /parking/gate/exit "{\"reservationId\":\"$RID1B\",\"recognizedPlate\":\"京A12345\",\"confidence\":0.95,\"couponCode\":\"NIGHT10\",\"at\":\"${TOMO}T04:00:00Z\"}")
echo "$E1" | jq '{billing:{baseFee:.billing.baseFee,overtimeFee:.billing.overtimeFee,couponDiscount:.billing.couponDiscount,payable:.billing.payable}}'

say "8. 物业对陌生占位车京C66666 追缴占位违约金 50 元"
jpost "$TPROP" "/parking/incidents/$I_S/charge-stranger" "{\"at\":\"${D}T20:50:00Z\"}" | jq '{kind,plate,strangerPenalty,payable,status}'

say "9. 三起错停/超时申诉"
say "9a. 京C66666 申诉：道闸失败+人工放行指引不清 → 引擎判物业责任，申诉成立"
A3=$(jpost "$TDR3" /appeals "{
  \"reservationId\":\"$RID3\",\"plate\":\"京C66666\",\"reason\":\"识别失败后保安让我跟车进入并随手指路，我按指引停到了 D 区，不是故意错停\",
  \"evidences\":[
    {\"kind\":\"site_photo\",\"content\":\"现场照片：车辆停在 D-009\",\"spotCode\":\"B2-D-009\",\"plate\":\"京C66666\",\"occurredAt\":\"${D}T19:15:00Z\",\"favorsAppellant\":false}]}")
AID3=$(echo "$A3" | jq -r .id)
echo "$A3" | jq '{status,suggestedResponsibility:.responsibility,driverShare,engineReason:.findings.reason,evidenceChain:[.findings.evidenceChain[]|{source,conclusion}]}'
jpost "$TPROP" "/appeals/$AID3/adjudicate" '{"note":"监控复核确认人工放行后指引错误，维持物业责任裁决"}' \
  | jq '{finalStatus:.status,responsibility,driverShare,refundAmount,ownerCompensation,creditImpact,creditDelta}'

say "9b. driver4 申诉：被陌生车阻挡后由平台调度改派 → 平台导航责任，成立"
A4=$(jpost "$TDR4" /appeals "{\"reservationId\":\"$RID4\",\"plate\":\"京D77777\",\"reason\":\"我的预约车位被别人占了，平台让我停去 C 区，申请补偿\"}")
AID4=$(echo "$A4" | jq -r .id)
jpost "$TPROP" "/appeals/$AID4/adjudicate" '{}' | jq '{status,responsibility,driverShare,refundAmount,creditImpact}'

say "9c. driver 申诉超时费：信号差没收到提醒 → 部分成立 50%，退还一半超时费，扣 3 信用分"
A1=$(jpost "$TDR" /appeals "{\"reservationId\":\"$RID1B\",\"plate\":\"京A12345\",\"reason\":\"地下车库没信号，完全没收到离场提醒，请求减免超时费\"}")
AID1=$(echo "$A1" | jq -r .id)
jpost "$TPROP" "/appeals/$AID1/adjudicate" '{"note":"信号弱有工单记录，部分成立"}' \
  | jq '{status,responsibility,driverShare,overtimeFee,refundAmount,creditImpact,creditDelta}'

say "9d. 车主信用分变化"
curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"username":"driver","password":"driver123"}' | jq '{user:.user|{displayName,creditScore}}'
curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"username":"driver3","password":"driver123"}' | jq '{user:.user|{displayName,creditScore}}'

say "10. 当晚收益合并清算（业主收益/物业费/平台抽成/优惠券/退款/异常补偿/陌生违约金）"
SETT=$(jpost "$TPROP" /settlements/run "{\"communityId\":\"$CID\",\"date\":\"$D\"}")
echo "$SETT" | jq '{date,status,totalCollected,totalRefund,totalCoupon,totalCompensation,ownerPayout,propertyFee,platformFee,
  ownerTotals:.breakdown.ownerTotals,
  sumCheck:(.ownerPayout+.propertyFee+.platformFee)}'

say "10b. 逐笔分账明细（每段时间谁使用/谁支付/谁违约）"
echo "$SETT" | jq -r '.items[] | "[\(.plate)] \(.spot.code) \(.segmentStart[11:16])-\(.segmentEnd[11:16])Z 司机付\(.paidByDriver) 业主\(.ownerAmount) 物业\(.propertyAmount) 平台\(.platformAmount) [\(.responsibility)]"'
echo
echo "$SETT" | jq -r '.items[0].note'

say "11. 同一车位时间线解释（D-009）"
curl -s "$BASE/trace/spots/$SPOT9/timeline?date=$D" | jq '{spot:.spot|{code,owner},reservations:.reservations|map({plate,status,clock:(.from[11:16]+"-"+.to[11:16])}),occupied:.occupiedSegments|map({plate,clock,status,billing:.billing|{payable}})}'

say "12. 全链路追溯（发布→预约→入场→异常→离场→申诉→分账）"
jget "$TPROP" /audit/all | jq -r '.[] | "\(.at[11:19])Z \(.actorKind|tostring|.[:7]) \(.action) \(.refType)"' | head -60
CNT=$(jget "$TPROP" /audit/all | jq 'length')
echo "审计日志总数: $CNT"

say "13. 道闸日志留痕"
jget "$TPROP" /parking/gate/events | jq -r '.[0:8][] | "\(.occurredAt[11:16])Z \(.direction|ascii_upcase) 识别=\(.recognizedPlate//"失败") \(.matchType) 抬杆=\(.barrierOpened)"'

echo; echo "E2E_FLOW_DONE"
