#include "../src/crypton.h"
#include <stdio.h>

int main(void)
{
    int failures = crypton_run_kat();
    printf("%d\n", failures);
    return failures != 0 ? 1 : 0;
}
