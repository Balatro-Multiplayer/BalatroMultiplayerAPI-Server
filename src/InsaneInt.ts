export class InsaneInt {
    startingECount: number;
    coefficient: number;
    exponent: number;

    constructor(startingECount: number, coefficient: number, exponent: number) {
        this.startingECount = startingECount;
        this.coefficient = coefficient;
        this.exponent = exponent;
    }

    static fromString (val: string | InsaneInt) {
        if (val instanceof InsaneInt) {
            return new InsaneInt(val.startingECount, val.coefficient, val.exponent);
        }

        console.log("Converting " + val + " to InsaneInt");
        let startingECount: number;
        let coefficient: number;
        let exponent: number;

        startingECount = 0;
        while (val.startsWith('e')) {
            startingECount += 1;
            val = val.slice(1);
        }

        if (val.includes('e')) {
            if (val.includes('#')) {
                startingECount += Number(val.split('#')[1]);
                val = val.split('#')[0];
            }
            [coefficient, exponent] = val.split('e').map(Number);
        } else {
            coefficient = Number(val);
            exponent = 0;
        }

        return new InsaneInt(startingECount, coefficient, exponent);
    }

    toString() {
        let result = "";
        for (let i = 0; i < this.startingECount; i++) {
            result += "e";
        }

        result += this.coefficient;
        if (this.exponent != 0) {
            result += "e" + this.exponent;
        }

        return result;
    }

    greaterThan(other: InsaneInt) {
        if (this.startingECount != other.startingECount) {
            return this.startingECount > other.startingECount;
        }
        
        if (this.exponent != other.exponent) {
            return this.exponent > other.exponent;
        }

        return this.coefficient > other.coefficient;
    }

    equalTo(other: InsaneInt) {
        return this.startingECount == other.startingECount && this.exponent == other.exponent && this.coefficient == other.coefficient;
    }

    lessThan(other: InsaneInt) {
        return !this.equalTo(other) && !this.greaterThan(other);
    }

    isBalanced(): boolean {

        // Wrong 0s
        if (this.coefficient == 0 && (this.exponent != 0 || this.startingECount != 0)) return false;
        if (this.exponent == 0 && this.startingECount != 0) return false;

        // Improper balancing
        if ((this.coefficient >= 10 && this.exponent > 0) || this.coefficient >= 100000000000) return false;
        if (this.coefficient < 1 && this.exponent > 0) return false;
        if (this.exponent > 0 && this.exponent < 1000000 && this.startingECount > 1) return false;
        if (this.exponent >= 100000000000) return false;

        // Decimals in exponents, or leading zeros
        if (this.exponent % 1 != 0 || this.startingECount % 1 != 0) return false;
        if (this.exponent > 0 && this.coefficient < 1) return false;



        return true;
    }

    balance() {
        while (!this.isBalanced()) {
            if (this.coefficient === 0) {
                this.exponent = 0;
                this.startingECount = 0;
                return;
            }
            // Ensure exponent is an integer
            if (this.startingECount > 0 && this.exponent % 1 != 0) {
                const prevECount = this.startingECount;
                this.startingECount = Math.max(this.startingECount - 1, 0);
                this.exponent *= Math.pow(10, prevECount - this.startingECount);
            }
            if (this.exponent % 1 != 0) {
                this.coefficient *= 1 / (this.exponent % 1);
                this.exponent = Math.floor(this.exponent);
            }

            // Balance coefficient and exponent
            if ((this.coefficient >= 10 && this.exponent > 0) || this.coefficient >= 100000000000) {
                const change = Math.floor(this.coefficient).toString().length - 1;
                this.coefficient /= Math.pow(10, change);
                this.exponent += change;
            }

            if (this.coefficient < 1 && this.exponent > 0) {
                let change = Math.ceil(Math.log10(1 / this.coefficient));
                if (change >= this.exponent) change = this.exponent - 1;
                this.coefficient *= Math.pow(10, change);
                this.exponent -= change / Math.pow(10, this.startingECount);
            }

            // Balance exponent and startingECount
            if ((this.exponent >= 100000000 && this.startingECount > 0) || this.exponent >= 100000000000) {
                const change = Math.floor(this.exponent).toString().length - 5;
                this.exponent /= Math.pow(10, change);
                this.startingECount += change;
            }
            if (this.exponent != 0 && this.exponent < 100000000000 && this.startingECount != 0) {
                let change = 5 - Math.floor(this.exponent).toString().length;
                if (change >= this.startingECount) change = this.startingECount - 1;
                this.exponent *= Math.pow(10, change);
                this.startingECount -= change;
            }
        };
    }

    add(other: InsaneInt) {
        // Balance the numbers
        this.balance();
        other.balance();

        // Make the exponents the same
        let startingECount;
        let coefficient;
        let exponent;

        const myStartingECount = this.startingECount;
        let myCoefficient = this.coefficient;
        let myExponent = this.exponent;

        const otherStartingECount = other.startingECount;
        let otherCoefficient = other.coefficient;
        let otherExponent = other.exponent;


        if (myStartingECount > otherStartingECount) {
            otherExponent = (otherExponent / Math.pow(10, (myStartingECount - otherStartingECount)));
            startingECount = myStartingECount;
        } else if (myStartingECount < otherStartingECount) {
            myExponent = (myExponent / Math.pow(10, (otherStartingECount - myStartingECount)));
            startingECount = otherStartingECount;
        } else {
            startingECount = myStartingECount;
        }

        if (myExponent > otherExponent) {
            coefficient = (otherCoefficient / Math.pow(10, (myExponent - otherExponent))) + myCoefficient;
            exponent = myExponent;
        } else if (myExponent < otherExponent) {
            coefficient = (myCoefficient / Math.pow(10, (otherExponent - myExponent))) + otherCoefficient;
            exponent = otherExponent;
        }  else {
            coefficient = myCoefficient + otherCoefficient;
            exponent = myExponent
        }
        
        let result = new InsaneInt(startingECount, coefficient, exponent);
        result.balance();
        return result;
    }

    div(other: InsaneInt) {
        // Balance the numbers
        this.balance();
        other.balance();

        if (other.coefficient === 0) {
            console.log("ERROR: Tried dividing by 0, returning 0");
            return new InsaneInt(0, 0, 0);
        };

        console.log("Dividing " + this.toString() + " by " + other.toString());

        let startingECount = this.startingECount;
        let coefficient = this.coefficient;
        let exponent = this.exponent;
        
        if (startingECount > other.startingECount) {
            exponent = exponent - (other.exponent / Math.pow(10, (startingECount - other.startingECount)));
            startingECount = this.startingECount;
        } else if (startingECount < other.startingECount) {
            exponent = (exponent / Math.pow(10, (other.startingECount - startingECount))) - other.exponent;
            startingECount = other.startingECount;
        } else {
            exponent -= other.exponent;
        }
 
        coefficient /= other.coefficient;
        let result = new InsaneInt(this.startingECount, coefficient, exponent);
        result.balance();
        return result;
    }
}