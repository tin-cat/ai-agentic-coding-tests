<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Catalog\Domain\Model\Shared;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Model\Shared\Currency;
use Frontstage\Catalog\Domain\Model\Shared\Money;
use PHPUnit\Framework\TestCase;

final class MoneyTest extends TestCase
{
	public function testConstructsWithValidAmountAndCurrency(): void
	{
		$money = Money::of(1500, Currency::of('USD'));

		$this->assertSame(1500, $money->amount);
		$this->assertSame('USD', $money->currency->code);
	}

	public function testRejectsNegativeAmount(): void
	{
		$this->expectException(InvalidArgument::class);
		Money::of(-1, Currency::of('USD'));
	}

	public function testEqualsByValue(): void
	{
		$a = Money::of(500, Currency::of('eur'));
		$b = Money::of(500, Currency::of('EUR'));
		$c = Money::of(500, Currency::of('USD'));

		$this->assertTrue($a->equals($b));
		$this->assertFalse($a->equals($c));
	}

	public function testCurrencyRejectsNonIsoCode(): void
	{
		$this->expectException(InvalidArgument::class);
		Currency::of('US');
	}
}
