-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "feishu_uid" TEXT NOT NULL,
    "employee_no" TEXT,
    "name_cn" TEXT,
    "name_en" TEXT,
    "department" TEXT,
    "hire_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "total_months" INTEGER NOT NULL,
    "monthly_amount" DECIMAL(10,3) NOT NULL,
    "attachment_path" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "approval_instance_id" VARCHAR(64),
    "approver_uid" VARCHAR(64),
    "approved_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_payments" (
    "id" SERIAL NOT NULL,
    "claim_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "actually_pay" DECIMAL(10,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_feishu_uid_key" ON "employees"("feishu_uid");

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_payments" ADD CONSTRAINT "monthly_payments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_payments" ADD CONSTRAINT "monthly_payments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
