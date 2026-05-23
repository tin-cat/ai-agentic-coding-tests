<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Exception;

use InvalidArgumentException;

/**
 * Thrown by domain factory methods and value object constructors when an
 * argument violates a domain invariant. The domain layer raises only its
 * own exception types so that adapters can translate them deliberately
 * (e.g. to HTTP 400) rather than leaking framework-specific errors.
 */
final class InvalidArgument extends InvalidArgumentException
{
}
